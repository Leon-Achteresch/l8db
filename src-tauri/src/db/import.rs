use std::collections::HashSet;
use std::sync::Arc;

use async_trait::async_trait;

use super::pool::PoolState;
use super::provider::DatabaseKind;
use super::{
    CsvConflict, CsvImportOutcome, CsvImportRequest, DatabaseAdapter, ImportColumnInfo,
    QueryResult, TxSession,
};

const MAX_BATCH_BYTES: usize = 2 * 1024 * 1024;
const ORACLE_LITERAL_CHUNK: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Oracle,
    Clickhouse,
    Duckdb,
}

impl Dialect {
    pub fn from_kind(kind: DatabaseKind) -> Option<Self> {
        Some(match kind {
            DatabaseKind::Postgres => Dialect::Postgres,
            DatabaseKind::Mysql => Dialect::Mysql,
            DatabaseKind::Sqlite => Dialect::Sqlite,
            DatabaseKind::Mssql => Dialect::Mssql,
            DatabaseKind::Oracle => Dialect::Oracle,
            DatabaseKind::Clickhouse => Dialect::Clickhouse,
            DatabaseKind::Duckdb => Dialect::Duckdb,
            _ => return None,
        })
    }

    pub fn quote(self, ident: &str) -> String {
        match self {
            Dialect::Mysql => format!("`{}`", ident.replace('`', "``")),
            Dialect::Clickhouse => format!("`{}`", ident.replace('`', "\\`")),
            Dialect::Mssql => format!("[{}]", ident.replace(']', "]]")),
            _ => format!("\"{}\"", ident.replace('"', "\"\"")),
        }
    }

    pub fn target(self, schema: &str, table: &str) -> String {
        if schema.is_empty() {
            self.quote(table)
        } else {
            format!("{}.{}", self.quote(schema), self.quote(table))
        }
    }

    pub fn transactional(self) -> bool {
        self != Dialect::Clickhouse
    }

    fn savepoint(self) -> Option<(&'static str, &'static str)> {
        match self {
            Dialect::Postgres | Dialect::Mysql | Dialect::Sqlite | Dialect::Oracle => {
                Some(("SAVEPOINT l8db_import", "ROLLBACK TO SAVEPOINT l8db_import"))
            }
            Dialect::Mssql => Some((
                "SAVE TRANSACTION l8db_import",
                "ROLLBACK TRANSACTION l8db_import",
            )),
            _ => None,
        }
    }

    pub fn batch_rows(self) -> usize {
        match self {
            Dialect::Oracle => 100,
            Dialect::Mssql => 500,
            Dialect::Clickhouse => 5000,
            _ => 1000,
        }
    }

    pub fn text_literal(self, value: &str) -> String {
        match self {
            Dialect::Mysql | Dialect::Clickhouse => format!(
                "'{}'",
                value
                    .replace('\\', "\\\\")
                    .replace('\'', if self == Dialect::Mysql { "''" } else { "\\'" })
            ),
            Dialect::Mssql => format!("N'{}'", value.replace('\'', "''")),
            Dialect::Oracle if value.len() > 3000 => {
                let chars: Vec<char> = value.chars().collect();
                chars
                    .chunks(ORACLE_LITERAL_CHUNK)
                    .map(|chunk| {
                        let text: String = chunk.iter().collect();
                        format!("TO_CLOB('{}')", text.replace('\'', "''"))
                    })
                    .collect::<Vec<_>>()
                    .join(" || ")
            }
            _ => format!("'{}'", value.replace('\'', "''")),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypeClass {
    Text,
    Integer,
    Decimal,
    Bool,
    Date,
    Timestamp,
    TimestampTz,
    Binary,
}

pub fn base_type(data_type: &str) -> String {
    let mut lower = data_type.trim().to_ascii_lowercase();
    loop {
        let inner = ["nullable(", "lowcardinality("]
            .iter()
            .find_map(|prefix| lower.strip_prefix(prefix))
            .and_then(|rest| rest.strip_suffix(')'))
            .map(str::to_string);
        match inner {
            Some(inner) => lower = inner,
            None => break,
        }
    }
    lower
}

pub fn classify(data_type: &str) -> TypeClass {
    let lower = base_type(data_type);
    if lower.ends_with("[]") || lower.starts_with("array") {
        return TypeClass::Text;
    }
    let base = lower.split('(').next().unwrap_or("").trim().to_string();
    let base = base
        .strip_suffix(" unsigned")
        .unwrap_or(&base)
        .trim()
        .to_string();
    if lower == "tinyint(1)" || base == "bit" || base.starts_with("bool") {
        return TypeClass::Bool;
    }
    if lower.contains("with time zone")
        || lower.contains("with local time zone")
        || base == "timestamptz"
        || base == "datetimeoffset"
    {
        return TypeClass::TimestampTz;
    }
    if base.starts_with("timestamp") || base.starts_with("datetime") || base == "smalldatetime" {
        return TypeClass::Timestamp;
    }
    if base == "date" || base == "date32" {
        return TypeClass::Date;
    }
    if matches!(
        base.as_str(),
        "smallint"
            | "integer"
            | "int"
            | "bigint"
            | "tinyint"
            | "mediumint"
            | "int2"
            | "int4"
            | "int8"
            | "serial"
            | "smallserial"
            | "bigserial"
            | "hugeint"
            | "ubigint"
            | "uinteger"
            | "usmallint"
            | "utinyint"
    ) || ((base.starts_with("int") || base.starts_with("uint"))
        && base.trim_start_matches('u')[3..]
            .chars()
            .all(|c| c.is_ascii_digit()))
    {
        return TypeClass::Integer;
    }
    if matches!(
        base.as_str(),
        "numeric"
            | "decimal"
            | "number"
            | "money"
            | "smallmoney"
            | "real"
            | "float"
            | "float4"
            | "float8"
            | "float32"
            | "float64"
            | "double"
            | "double precision"
            | "binary_float"
            | "binary_double"
    ) || base.starts_with("decimal")
    {
        return TypeClass::Decimal;
    }
    if super::is_binary_column_type(data_type)
        || matches!(
            base.as_str(),
            "blob" | "bytea" | "longblob" | "mediumblob" | "tinyblob" | "image" | "raw"
        )
    {
        return TypeClass::Binary;
    }
    TypeClass::Text
}

fn is_number(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.' | 'e' | 'E'))
        && trimmed.parse::<f64>().is_ok_and(f64::is_finite)
}

pub fn parse_bool(value: &str) -> Option<bool> {
    match value.trim().to_ascii_lowercase().as_str() {
        "true" | "t" | "yes" | "y" | "1" | "ja" | "wahr" | "on" => Some(true),
        "false" | "f" | "no" | "n" | "0" | "nein" | "falsch" | "off" => Some(false),
        _ => None,
    }
}

type Moment = (chrono::NaiveDateTime, Option<chrono::FixedOffset>);

pub fn parse_moment(value: &str) -> Option<Moment> {
    let trimmed = value.trim();
    if let Ok(moment) = chrono::DateTime::parse_from_rfc3339(trimmed) {
        return Some((moment.naive_local(), Some(*moment.offset())));
    }
    let normalized = trimmed.replacen(' ', "T", 1);
    for format in ["%Y-%m-%dT%H:%M:%S%.f%#z", "%Y-%m-%dT%H:%M:%S%.f %#z"] {
        if let Ok(moment) = chrono::DateTime::parse_from_str(&normalized, format) {
            return Some((moment.naive_local(), Some(*moment.offset())));
        }
    }
    for format in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"] {
        if let Ok(moment) = chrono::NaiveDateTime::parse_from_str(&normalized, format) {
            return Some((moment, None));
        }
    }
    chrono::NaiveDate::parse_from_str(trimmed, "%Y-%m-%d")
        .ok()
        .map(|date| (date.and_time(chrono::NaiveTime::MIN), None))
}

fn hex_body(value: &str) -> Option<String> {
    let trimmed = value.trim();
    let body = trimmed
        .strip_prefix("\\x")
        .or_else(|| trimmed.strip_prefix("0x"))
        .or_else(|| trimmed.strip_prefix("0X"))?;
    (body.len() % 2 == 0 && body.bytes().all(|b| b.is_ascii_hexdigit()))
        .then(|| body.to_ascii_lowercase())
}

pub fn literal(dialect: Dialect, data_type: &str, value: Option<&str>) -> String {
    let Some(value) = value else {
        return "NULL".into();
    };
    if dialect == Dialect::Postgres {
        return super::quote_literal(value);
    }
    let class = classify(data_type);
    match class {
        TypeClass::Integer | TypeClass::Decimal if is_number(value) => value.trim().to_string(),
        TypeClass::Integer | TypeClass::Decimal
            if matches!(value.trim().to_ascii_lowercase().as_str(), "true" | "false") =>
        {
            if value.trim().eq_ignore_ascii_case("true") {
                "1"
            } else {
                "0"
            }
            .into()
        }
        TypeClass::Bool => match parse_bool(value) {
            Some(flag) => match dialect {
                Dialect::Mysql | Dialect::Mssql | Dialect::Sqlite => {
                    if flag { "1" } else { "0" }.into()
                }
                _ => if flag { "TRUE" } else { "FALSE" }.into(),
            },
            None => dialect.text_literal(value),
        },
        TypeClass::Binary => match hex_body(value) {
            Some(hex) => match dialect {
                Dialect::Mysql | Dialect::Sqlite => format!("X'{hex}'"),
                Dialect::Mssql => format!("0x{hex}"),
                Dialect::Oracle => format!("HEXTORAW('{hex}')"),
                _ => format!("unhex('{hex}')"),
            },
            None => dialect.text_literal(value),
        },
        TypeClass::Date | TypeClass::Timestamp | TypeClass::TimestampTz => {
            match (dialect, parse_moment(value)) {
                (Dialect::Oracle, Some((moment, offset))) => {
                    let text = moment.format("%Y-%m-%d %H:%M:%S%.6f").to_string();
                    match offset.filter(|_| class == TypeClass::TimestampTz) {
                        Some(offset) => format!("TIMESTAMP '{text} {offset}'"),
                        None => format!("TIMESTAMP '{text}'"),
                    }
                }
                (Dialect::Mssql, Some((moment, offset))) => match class {
                    TypeClass::Date => format!("CAST('{}' AS date)", moment.format("%Y-%m-%d")),
                    TypeClass::TimestampTz => format!(
                        "CAST('{}{}' AS datetimeoffset)",
                        moment.format("%Y-%m-%dT%H:%M:%S%.f"),
                        offset
                            .map(|o| o.to_string())
                            .unwrap_or_else(|| "+00:00".into())
                    ),
                    _ => format!(
                        "CAST('{}' AS datetime2)",
                        moment.format("%Y-%m-%dT%H:%M:%S%.f")
                    ),
                },
                _ => dialect.text_literal(value),
            }
        }
        _ => dialect.text_literal(value),
    }
}

#[derive(Debug, Clone)]
pub struct ConflictPlan {
    pub constraint: String,
    pub keys: Vec<String>,
    pub updates: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ImportPlan {
    pub dialect: Dialect,
    pub target: String,
    pub columns: Vec<ImportColumnInfo>,
    pub conflict: Option<ConflictPlan>,
    pub identity_insert: bool,
}

impl ImportPlan {
    fn column_list(&self) -> String {
        self.columns
            .iter()
            .map(|column| self.dialect.quote(&column.name))
            .collect::<Vec<_>>()
            .join(", ")
    }

    pub fn row_literals(&self, row: &[Option<String>]) -> Vec<String> {
        self.columns
            .iter()
            .zip(row)
            .map(|(column, value)| literal(self.dialect, &column.data_type, value.as_deref()))
            .collect()
    }

    fn key_positions(&self) -> Vec<usize> {
        self.conflict
            .as_ref()
            .map(|conflict| {
                conflict
                    .keys
                    .iter()
                    .filter_map(|key| self.columns.iter().position(|c| &c.name == key))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub fn existing_count_sql(&self, rows: &[Vec<String>]) -> Option<String> {
        let conflict = self.conflict.as_ref()?;
        let positions = self.key_positions();
        let tuples: Vec<Vec<&str>> = rows
            .iter()
            .filter(|row| positions.iter().all(|p| row[*p] != "NULL"))
            .map(|row| positions.iter().map(|p| row[*p].as_str()).collect())
            .collect();
        if tuples.is_empty() {
            return Some(String::new());
        }
        let keys: Vec<String> = conflict
            .keys
            .iter()
            .map(|k| self.dialect.quote(k))
            .collect();
        let condition = if keys.len() == 1 {
            format!(
                "{} IN ({})",
                keys[0],
                tuples.iter().map(|t| t[0]).collect::<Vec<_>>().join(", ")
            )
        } else if self.dialect == Dialect::Mssql {
            tuples
                .iter()
                .map(|tuple| {
                    let parts = keys
                        .iter()
                        .zip(tuple)
                        .map(|(key, value)| format!("{key} = {value}"))
                        .collect::<Vec<_>>()
                        .join(" AND ");
                    format!("({parts})")
                })
                .collect::<Vec<_>>()
                .join(" OR ")
        } else {
            let list = tuples
                .iter()
                .map(|tuple| format!("({})", tuple.join(", ")))
                .collect::<Vec<_>>()
                .join(", ");
            if self.dialect == Dialect::Sqlite {
                format!("({}) IN (VALUES {list})", keys.join(", "))
            } else {
                format!("({}) IN ({list})", keys.join(", "))
            }
        };
        Some(format!(
            "SELECT COUNT(*) AS n FROM {} WHERE {condition}",
            self.target
        ))
    }

    pub fn insert_sql(&self, rows: &[Vec<String>]) -> String {
        let columns = self.column_list();
        let d = self.dialect;
        let values = || {
            rows.iter()
                .map(|row| format!("({})", row.join(", ")))
                .collect::<Vec<_>>()
                .join(", ")
        };
        let oracle_select = || {
            rows.iter()
                .enumerate()
                .map(|(index, row)| {
                    let cells = row
                        .iter()
                        .zip(&self.columns)
                        .map(|(value, column)| {
                            if index == 0 {
                                format!("{value} AS {}", d.quote(&column.name))
                            } else {
                                value.clone()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    format!("SELECT {cells} FROM DUAL")
                })
                .collect::<Vec<_>>()
                .join(" UNION ALL ")
        };
        let Some(conflict) = &self.conflict else {
            return match d {
                Dialect::Oracle => format!(
                    "INSERT INTO {} ({columns}) {}",
                    self.target,
                    oracle_select()
                ),
                Dialect::Postgres => format!(
                    "INSERT INTO {} ({columns}) VALUES {} RETURNING (xmax = 0)",
                    self.target,
                    values()
                ),
                _ => format!(
                    "INSERT INTO {} ({columns}) VALUES {}",
                    self.target,
                    values()
                ),
            };
        };
        let keys = conflict
            .keys
            .iter()
            .map(|key| d.quote(key))
            .collect::<Vec<_>>();
        let set = |left: &dyn Fn(&str) -> String, right: &dyn Fn(&str) -> String| {
            conflict
                .updates
                .iter()
                .map(|column| format!("{} = {}", left(column), right(column)))
                .collect::<Vec<_>>()
                .join(", ")
        };
        match d {
            Dialect::Postgres => format!(
                "INSERT INTO {} ({columns}) VALUES {} ON CONFLICT ON CONSTRAINT {} {} RETURNING (xmax = 0)",
                self.target,
                values(),
                d.quote(&conflict.constraint),
                if conflict.updates.is_empty() {
                    "DO NOTHING".to_string()
                } else {
                    format!(
                        "DO UPDATE SET {}",
                        set(&|c| d.quote(c), &|c| format!("EXCLUDED.{}", d.quote(c)))
                    )
                }
            ),
            Dialect::Mysql => format!(
                "INSERT INTO {} ({columns}) VALUES {} ON DUPLICATE KEY UPDATE {}",
                self.target,
                values(),
                if conflict.updates.is_empty() {
                    format!("{} = {}", keys[0], keys[0])
                } else {
                    set(&|c| d.quote(c), &|c| format!("VALUES({})", d.quote(c)))
                }
            ),
            Dialect::Sqlite | Dialect::Duckdb => format!(
                "INSERT INTO {} ({columns}) VALUES {} ON CONFLICT ({}) {}",
                self.target,
                values(),
                keys.join(", "),
                if conflict.updates.is_empty() {
                    "DO NOTHING".to_string()
                } else {
                    format!(
                        "DO UPDATE SET {}",
                        set(&|c| d.quote(c), &|c| format!("excluded.{}", d.quote(c)))
                    )
                }
            ),
            Dialect::Mssql | Dialect::Oracle => {
                let on = conflict
                    .keys
                    .iter()
                    .map(|key| format!("d.{} = s.{}", d.quote(key), d.quote(key)))
                    .collect::<Vec<_>>()
                    .join(" AND ");
                let source = if d == Dialect::Mssql {
                    format!("(VALUES {}) AS s ({columns})", values())
                } else {
                    format!("({}) s", oracle_select())
                };
                let matched = if conflict.updates.is_empty() {
                    String::new()
                } else {
                    format!(
                        " WHEN MATCHED THEN UPDATE SET {}",
                        set(&|c| format!("d.{}", d.quote(c)), &|c| format!(
                            "s.{}",
                            d.quote(c)
                        ))
                    )
                };
                let inserted = self
                    .columns
                    .iter()
                    .map(|column| format!("s.{}", d.quote(&column.name)))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "MERGE INTO {} {}d USING {source} ON ({on}){matched} WHEN NOT MATCHED THEN INSERT ({columns}) VALUES ({inserted}){}",
                    self.target,
                    if d == Dialect::Mssql { "AS " } else { "" },
                    if d == Dialect::Mssql { ";" } else { "" }
                )
            }
            Dialect::Clickhouse => {
                format!("INSERT INTO {} ({columns}) VALUES {}", self.target, values())
            }
        }
    }
}

fn cell_text(result: &QueryResult, row: usize, column: usize) -> Option<String> {
    let name = result.columns.get(column)?;
    super::export::value_text(result.rows.get(row)?.get(name)?)
}

fn cell_flag(result: &QueryResult, row: usize, column: usize) -> bool {
    matches!(
        cell_text(result, row, column)
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "1" | "true" | "t" | "yes" | "y"
    )
}

fn catalog_sql(dialect: Dialect, schema: &str, table: &str) -> Result<String, String> {
    let lit = |value: &str| dialect.text_literal(value);
    Ok(match dialect {
        Dialect::Postgres => return Err("Postgres nutzt den Adapter-Katalog.".into()),
        Dialect::Mysql => format!(
            "SELECT column_name, column_type, is_nullable = 'YES', column_default IS NOT NULL, extra LIKE '%auto_increment%', (extra LIKE '%VIRTUAL GENERATED%' OR extra LIKE '%STORED GENERATED%'), ordinal_position FROM information_schema.columns WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
            lit(schema),
            lit(table)
        ),
        Dialect::Sqlite => format!(
            "SELECT name, type, \"notnull\" = 0, dflt_value IS NOT NULL, pk, hidden, cid FROM pragma_table_xinfo({}, {})",
            lit(table),
            lit(if schema.is_empty() { "main" } else { schema })
        ),
        Dialect::Mssql => format!(
            "SELECT c.name, TYPE_NAME(c.user_type_id), c.is_nullable, CASE WHEN c.default_object_id <> 0 THEN 1 ELSE 0 END, c.is_identity, CASE WHEN c.is_computed = 1 OR TYPE_NAME(c.user_type_id) IN ('timestamp', 'rowversion') THEN 1 ELSE 0 END, c.column_id FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id JOIN sys.schemas s ON s.schema_id = o.schema_id WHERE s.name = {} AND o.name = {} AND o.type IN ('U', 'V') ORDER BY c.column_id",
            lit(schema),
            lit(table)
        ),
        Dialect::Oracle => format!(
            "SELECT column_name, data_type, CASE WHEN nullable = 'Y' THEN 1 ELSE 0 END, CASE WHEN default_length > 0 THEN 1 ELSE 0 END, CASE WHEN identity_column = 'YES' THEN 1 ELSE 0 END, CASE WHEN virtual_column = 'YES' THEN 1 ELSE 0 END, column_id FROM all_tab_cols WHERE owner = {} AND table_name = {} AND hidden_column = 'NO' ORDER BY column_id",
            lit(schema),
            lit(table)
        ),
        Dialect::Clickhouse => format!(
            "SELECT name, type, startsWith(type, 'Nullable'), default_kind = 'DEFAULT', 0, default_kind IN ('MATERIALIZED', 'ALIAS', 'EPHEMERAL'), position FROM system.columns WHERE database = {} AND table = {} ORDER BY position",
            lit(schema),
            lit(table)
        ),
        Dialect::Duckdb => format!(
            "SELECT column_name, data_type, is_nullable = 'YES', column_default IS NOT NULL AND column_default NOT LIKE 'nextval%', column_default LIKE 'nextval%', false, ordinal_position FROM information_schema.columns WHERE table_schema = {} AND table_name = {} ORDER BY ordinal_position",
            lit(schema),
            lit(table)
        ),
    })
}

pub async fn list_import_columns(
    dialect: Dialect,
    adapter: &dyn DatabaseAdapter,
    schema: &str,
    table: &str,
) -> Result<Vec<ImportColumnInfo>, String> {
    if dialect == Dialect::Postgres {
        return adapter.list_import_columns(schema, table).await;
    }
    let result = adapter
        .execute_query(&catalog_sql(dialect, schema, table)?)
        .await?;
    if result.rows.is_empty() {
        return Err(format!("Tabelle {schema}.{table} wurde nicht gefunden."));
    }
    let sqlite_pk: Vec<usize> = (0..result.rows.len())
        .filter(|row| {
            cell_text(&result, *row, 4)
                .and_then(|value| value.parse::<i64>().ok())
                .is_some_and(|value| value > 0)
        })
        .collect();
    Ok((0..result.rows.len())
        .map(|row| {
            let data_type = cell_text(&result, row, 1).unwrap_or_default();
            let (is_identity, is_generated) = if dialect == Dialect::Sqlite {
                let hidden = cell_text(&result, row, 5).unwrap_or_default();
                (
                    sqlite_pk == [row] && data_type.eq_ignore_ascii_case("integer"),
                    hidden == "2" || hidden == "3",
                )
            } else {
                (cell_flag(&result, row, 4), cell_flag(&result, row, 5))
            };
            ImportColumnInfo {
                name: cell_text(&result, row, 0).unwrap_or_default(),
                data_type,
                is_nullable: cell_flag(&result, row, 2) || is_identity,
                has_default: cell_flag(&result, row, 3),
                is_identity,
                is_generated,
                ordinal_position: cell_text(&result, row, 6)
                    .and_then(|value| value.parse::<i32>().ok())
                    .unwrap_or(row as i32 + 1),
            }
        })
        .collect())
}

pub async fn prepare_plan(
    dialect: Dialect,
    adapter: &dyn DatabaseAdapter,
    schema: &str,
    table: &str,
    columns: &[String],
    conflict: Option<&CsvConflict>,
) -> Result<ImportPlan, String> {
    if columns.is_empty() {
        return Err("Keine Zielspalten zugeordnet.".to_string());
    }
    let available = list_import_columns(dialect, adapter, schema, table).await?;
    let mut mapped = Vec::with_capacity(columns.len());
    for column in columns {
        if mapped.iter().any(|c: &ImportColumnInfo| &c.name == column) {
            return Err(format!("Zielspalte {column} ist mehrfach zugeordnet."));
        }
        let found = available
            .iter()
            .find(|c| &c.name == column)
            .ok_or_else(|| format!("Unbekannte Spalte: {column}"))?;
        if found.is_generated {
            return Err(format!(
                "Generierte Spalte {column} kann nicht befüllt werden."
            ));
        }
        mapped.push(found.clone());
    }
    let conflict = match conflict {
        None => None,
        Some(_) if dialect == Dialect::Clickhouse => {
            return Err("ClickHouse unterstützt keine Konfliktbehandlung beim Import.".into())
        }
        Some(conflict) => {
            let constraint = adapter
                .list_constraints(schema, table)
                .await?
                .into_iter()
                .find(|c| {
                    c.name == conflict.constraint
                        && matches!(c.constraint_type.as_str(), "PRIMARY KEY" | "UNIQUE")
                })
                .ok_or("Konfliktziel muss ein Primär- oder Unique-Schlüssel sein.")?;
            let keys = constraint.columns;
            if keys.is_empty() || keys.iter().any(|key| !columns.contains(key)) {
                return Err("Alle Konfliktschlüssel müssen zugeordnet sein.".into());
            }
            for name in &conflict.update_columns {
                if keys.contains(name)
                    || !columns.contains(name)
                    || available.iter().any(|column| {
                        column.name == *name && (column.is_generated || column.is_identity)
                    })
                {
                    return Err(format!("Spalte {name} darf nicht aktualisiert werden."));
                }
            }
            Some(ConflictPlan {
                constraint: conflict.constraint.clone(),
                keys,
                updates: conflict.update_columns.clone(),
            })
        }
    };
    Ok(ImportPlan {
        dialect,
        target: dialect.target(schema, table),
        identity_insert: dialect == Dialect::Mssql && mapped.iter().any(|c| c.is_identity),
        columns: mapped,
        conflict,
    })
}

pub struct PgTx {
    client: tokio_postgres::Client,
    ssl: super::SslMode,
}

impl PgTx {
    pub async fn open(
        config: &tokio_postgres::Config,
        ssl: super::SslMode,
    ) -> Result<Self, String> {
        let client = super::execution::connect_postgres(config, ssl).await?;
        super::postgres::begin_guarded(&client, "BEGIN", &[super::postgres::STREAM_IDLE_GUARD])
            .await
            .map_err(super::map_pg_err)?;
        Ok(Self { client, ssl })
    }
}

#[async_trait]
impl TxSession for PgTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        use tokio_postgres::SimpleQueryMessage;
        let client = &self.client;
        super::execution::postgres(client, self.ssl, None, async {
            let start = std::time::Instant::now();
            let messages = client.simple_query(sql).await.map_err(super::map_pg_err)?;
            let mut columns = Vec::new();
            let mut rows = Vec::new();
            let mut affected = None;
            for message in messages {
                match message {
                    SimpleQueryMessage::Row(row) => {
                        if columns.is_empty() {
                            columns = row
                                .columns()
                                .iter()
                                .map(|column| column.name().to_string())
                                .collect();
                        }
                        let object: serde_json::Map<String, serde_json::Value> = columns
                            .iter()
                            .enumerate()
                            .map(|(index, name)| {
                                (
                                    name.clone(),
                                    row.get(index)
                                        .map(|v| serde_json::Value::String(v.to_string()))
                                        .unwrap_or(serde_json::Value::Null),
                                )
                            })
                            .collect();
                        rows.push(serde_json::Value::Object(object));
                    }
                    SimpleQueryMessage::CommandComplete(count) => affected = Some(count),
                    _ => {}
                }
            }
            Ok(QueryResult {
                columns,
                rows,
                rows_affected: affected,
                execution_time_ms: start.elapsed().as_millis() as u64,
            })
        })
        .await
    }

    async fn commit(&mut self) -> Result<(), String> {
        let client = &self.client;
        super::execution::postgres(client, self.ssl, None, async {
            client
                .simple_query("COMMIT")
                .await
                .map(|_| ())
                .map_err(super::map_pg_err)
        })
        .await
    }

    async fn rollback(&mut self) -> Result<(), String> {
        tokio::time::timeout(
            super::execution::connection_duration(),
            self.client.simple_query("ROLLBACK"),
        )
        .await
        .map_err(|_| "Rollback nicht bestätigt; Serverzustand prüfen.".to_string())?
        .map(|_| ())
        .map_err(super::map_pg_err)
    }
}

type OracleConn = Arc<std::sync::Mutex<oracle::Connection>>;

struct OracleTx {
    conn: OracleConn,
}

impl OracleTx {
    async fn run<T, F>(&self, f: F) -> Result<T, String>
    where
        T: Send + 'static,
        F: FnOnce(&mut oracle::Connection) -> Result<T, String> + Send + 'static,
    {
        let conn = self.conn.clone();
        tokio::task::spawn_blocking(move || {
            let mut guard = conn
                .lock()
                .map_err(|_| "Oracle-Verbindung ist blockiert".to_string())?;
            f(&mut guard)
        })
        .await
        .map_err(|e| format!("Oracle-Task fehlgeschlagen: {e}"))?
    }
}

#[async_trait]
impl TxSession for OracleTx {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        let sql = sql.to_string();
        self.run(move |c| super::oracle::tx_execute(c, &sql)).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        self.run(|c| super::oracle::tx_finish(c, true)).await
    }
    async fn rollback(&mut self) -> Result<(), String> {
        self.run(|c| super::oracle::tx_finish(c, false)).await
    }
}

struct AutoCommit {
    adapter: Box<dyn DatabaseAdapter>,
}

#[async_trait]
impl TxSession for AutoCommit {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
        self.adapter.execute_query(sql).await
    }
    async fn commit(&mut self) -> Result<(), String> {
        Ok(())
    }
    async fn rollback(&mut self) -> Result<(), String> {
        Ok(())
    }
}

pub async fn open_session(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool: PoolState,
) -> Result<Box<dyn TxSession>, String> {
    Ok(match kind {
        DatabaseKind::Postgres => {
            if super::connection::connection_string_is_read_only(connection_string) {
                return Err("Lesemodus: Diese Verbindung ist schreibgeschützt.".into());
            }
            let (config, ssl) = super::connection::parse_connection(connection_string, database)?;
            Box::new(PgTx::open(&config, ssl).await?)
        }
        DatabaseKind::Oracle => {
            let key = super::connection::connection_key(connection_string, database);
            let adapter = super::oracle::OracleAdapter::new(connection_string, pool, key)?;
            let mut conn = adapter.open_connection().await?;
            super::oracle::tx_begin(
                conn.get_mut()
                    .map_err(|_| "Oracle-Verbindung ist blockiert")?,
            );
            Box::new(OracleTx {
                conn: Arc::new(conn),
            })
        }
        DatabaseKind::Clickhouse => Box::new(AutoCommit {
            adapter: super::create_adapter_from_string(kind, connection_string, database, pool)?,
        }),
        _ => {
            super::create_adapter_from_string(kind, connection_string, database, pool)?
                .begin_transaction()
                .await?
        }
    })
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Counts {
    pub inserted: u64,
    pub updated: u64,
    pub skipped: u64,
}

pub struct Failure {
    pub row: Option<u32>,
    pub message: String,
}

pub struct BatchWriter {
    plan: ImportPlan,
    session: Box<dyn TxSession>,
    batch: Vec<Vec<String>>,
    batch_keys: HashSet<String>,
    batch_bytes: usize,
    batch_start: usize,
    processed: usize,
    counts: Counts,
    started: bool,
}

impl BatchWriter {
    pub fn new(plan: ImportPlan, session: Box<dyn TxSession>) -> Self {
        Self {
            plan,
            session,
            batch: Vec::new(),
            batch_keys: HashSet::new(),
            batch_bytes: 0,
            batch_start: 0,
            processed: 0,
            counts: Counts::default(),
            started: false,
        }
    }

    pub fn counts(&self) -> Counts {
        self.counts
    }

    pub fn processed(&self) -> usize {
        self.processed
    }

    async fn start(&mut self) -> Result<(), Failure> {
        if self.started {
            return Ok(());
        }
        self.started = true;
        if self.plan.identity_insert {
            let sql = format!("SET IDENTITY_INSERT {} ON", self.plan.target);
            self.session
                .execute(&sql)
                .await
                .map_err(|message| Failure { row: None, message })?;
        }
        Ok(())
    }

    pub async fn push(&mut self, row: Vec<Option<String>>) -> Result<(), Failure> {
        if row.len() != self.plan.columns.len() {
            return Err(Failure {
                row: Some(self.processed as u32 + 1),
                message: format!(
                    "Zeile hat {} Werte, erwartet werden {}.",
                    row.len(),
                    self.plan.columns.len()
                ),
            });
        }
        let literals = self.plan.row_literals(&row);
        let positions = self.plan.key_positions();
        if !positions.is_empty() {
            let key = positions
                .iter()
                .map(|p| literals[*p].as_str())
                .collect::<Vec<_>>()
                .join("\u{0}");
            if self.batch_keys.contains(&key) {
                self.flush().await?;
            }
            self.batch_keys.insert(key);
        }
        if self.batch.is_empty() {
            self.batch_start = self.processed;
        }
        self.batch_bytes += literals.iter().map(String::len).sum::<usize>() + 8;
        self.batch.push(literals);
        self.processed += 1;
        if self.batch.len() >= self.plan.dialect.batch_rows() || self.batch_bytes >= MAX_BATCH_BYTES
        {
            self.flush().await?;
        }
        Ok(())
    }

    async fn run_batch(&mut self, rows: &[Vec<String>]) -> Result<Counts, String> {
        let existing = match self.plan.existing_count_sql(rows) {
            Some(sql) if sql.is_empty() => Some(0),
            Some(sql) if self.plan.dialect != Dialect::Postgres => {
                let result = self.session.execute(&sql).await?;
                Some(
                    cell_text(&result, 0, 0)
                        .and_then(|value| value.parse::<f64>().ok())
                        .unwrap_or(0.0) as u64,
                )
            }
            _ => None,
        };
        let result = self.session.execute(&self.plan.insert_sql(rows)).await?;
        let total = rows.len() as u64;
        Ok(if self.plan.dialect == Dialect::Postgres {
            let inserted = (0..result.rows.len())
                .filter(|row| cell_flag(&result, *row, 0))
                .count() as u64;
            let returned = result.rows.len() as u64;
            Counts {
                inserted,
                updated: returned - inserted,
                skipped: total.saturating_sub(returned),
            }
        } else {
            let existing = existing.unwrap_or(0).min(total);
            match &self.plan.conflict {
                Some(conflict) if conflict.updates.is_empty() => Counts {
                    inserted: total - existing,
                    updated: 0,
                    skipped: existing,
                },
                Some(_) => Counts {
                    inserted: total - existing,
                    updated: existing,
                    skipped: 0,
                },
                None => Counts {
                    inserted: total,
                    updated: 0,
                    skipped: 0,
                },
            }
        })
    }

    async fn locate(&mut self, rows: &[Vec<String>]) -> Option<usize> {
        let (_, rollback) = self.plan.dialect.savepoint()?;
        self.session.execute(rollback).await.ok()?;
        for (index, row) in rows.iter().enumerate() {
            if self
                .session
                .execute(&self.plan.insert_sql(std::slice::from_ref(row)))
                .await
                .is_err()
            {
                return Some(index);
            }
        }
        None
    }

    pub async fn flush(&mut self) -> Result<(), Failure> {
        if self.batch.is_empty() {
            return Ok(());
        }
        self.start().await?;
        if super::execution::cancellation_token().is_cancelled() {
            return Err(Failure {
                row: None,
                message: "Import vom Benutzer abgebrochen.".into(),
            });
        }
        let rows = std::mem::take(&mut self.batch);
        self.batch_keys.clear();
        self.batch_bytes = 0;
        let savepoint = self.plan.dialect.savepoint();
        if let Some((create, _)) = savepoint {
            self.session
                .execute(create)
                .await
                .map_err(|message| Failure {
                    row: Some(self.batch_start as u32 + 1),
                    message,
                })?;
        }
        match self.run_batch(&rows).await {
            Ok(counts) => {
                self.counts.inserted += counts.inserted;
                self.counts.updated += counts.updated;
                self.counts.skipped += counts.skipped;
                super::execution::progress(self.processed as u64);
                Ok(())
            }
            Err(message) => {
                let offset = if rows.len() > 1 && savepoint.is_some() {
                    self.locate(&rows).await.unwrap_or(0)
                } else {
                    0
                };
                Err(Failure {
                    row: Some((self.batch_start + offset + 1) as u32),
                    message,
                })
            }
        }
    }

    pub async fn commit(mut self) -> Result<Counts, Failure> {
        self.flush().await?;
        if self.plan.identity_insert && self.started {
            let sql = format!("SET IDENTITY_INSERT {} OFF", self.plan.target);
            let _ = self.session.execute(&sql).await;
        }
        self.session.commit().await.map_err(|error| Failure {
            row: None,
            message: format!(
                "Commit-Ergebnis nicht bestätigt: {error}. Vor erneutem Import den Serverzustand prüfen."
            ),
        })?;
        Ok(self.counts)
    }

    pub async fn abort(mut self) -> Result<(), String> {
        self.session.rollback().await
    }

    pub fn transactional(&self) -> bool {
        self.plan.dialect.transactional()
    }
}

pub fn failure_outcome(
    failure: Failure,
    columns: &[String],
    rollback: Result<(), String>,
    transactional: bool,
    counts: Counts,
) -> CsvImportOutcome {
    let failed_column = columns
        .iter()
        .find(|column| failure.message.contains(column.as_str()))
        .cloned();
    let suffix = match (transactional, rollback) {
        (true, Ok(())) => "Import vollständig zurückgerollt.".to_string(),
        (true, Err(_)) => {
            "Rollback nicht bestätigt; Serverzustand vor erneutem Import prüfen.".to_string()
        }
        (false, _) => format!(
            "Keine Transaktion: {} bereits geschriebene Zeile(n) bleiben erhalten.",
            counts.inserted
        ),
    };
    let counts = if transactional {
        Counts::default()
    } else {
        counts
    };
    CsvImportOutcome {
        inserted_rows: counts.inserted,
        updated_rows: counts.updated,
        skipped_rows: counts.skipped,
        failed_row: failure.row,
        failed_column,
        error: Some(format!("{} {suffix}", failure.message)),
    }
}

pub fn validate_request(request: &CsvImportRequest) -> Result<(), String> {
    if request.columns.is_empty() {
        return Err("Keine Zielspalten zugeordnet.".to_string());
    }
    if request.file.is_some() && !request.rows.is_empty() {
        return Err("Datei und direkte Datenzeilen dürfen nicht kombiniert werden.".into());
    }
    if request.rows.is_empty() && request.file.is_none() {
        return Err("Keine Datenzeilen zum Import.".to_string());
    }
    if request.rows.len() > super::CSV_IMPORT_MAX_ROWS {
        return Err(format!(
            "Zu viele Zeilen: {} (Maximum {}).",
            request.rows.len(),
            super::CSV_IMPORT_MAX_ROWS
        ));
    }
    if let Some(source) = &request.file {
        if source.indices.len() != request.columns.len() {
            return Err("Datei-Zuordnung stimmt nicht mit Zielspalten überein.".into());
        }
    }
    for (index, row) in request.rows.iter().enumerate() {
        if row.len() != request.columns.len() {
            return Err(format!(
                "Zeile {} hat {} Werte, erwartet werden {}.",
                index + 1,
                row.len(),
                request.columns.len()
            ));
        }
    }
    Ok(())
}

pub async fn run_import(
    plan: ImportPlan,
    session: Box<dyn TxSession>,
    request: &CsvImportRequest,
) -> Result<CsvImportOutcome, String> {
    validate_request(request)?;
    let rows: super::import_source::RowStream = match &request.file {
        Some(source) => super::import_source::open_rows(source)?,
        None => Box::new(request.rows.clone().into_iter().map(Ok)),
    };
    let mut writer = BatchWriter::new(plan, session);
    for (index, row) in rows.enumerate() {
        let failure = match row {
            Ok(row) => match writer.push(row).await {
                Ok(()) => continue,
                Err(failure) => failure,
            },
            Err(error) => {
                let transactional = writer.transactional();
                let rollback = writer.abort().await;
                if transactional {
                    rollback?;
                    return Err(format!(
                        "Datensatz {}: {error} Import vollständig zurückgerollt.",
                        index + 1
                    ));
                }
                return Err(format!(
                    "Datensatz {}: {error} Keine Transaktion: bereits geschriebene Zeilen bleiben erhalten.",
                    index + 1
                ));
            }
        };
        return Ok(finish_failure(writer, failure, &request.columns).await);
    }
    let transactional = writer.transactional();
    let counts = writer.counts();
    let processed = writer.processed();
    match writer.commit().await {
        Ok(counts) => {
            super::execution::progress(processed as u64);
            Ok(CsvImportOutcome {
                inserted_rows: counts.inserted,
                updated_rows: counts.updated,
                skipped_rows: counts.skipped,
                failed_row: None,
                failed_column: None,
                error: None,
            })
        }
        Err(failure) => Ok(failure_outcome(
            failure,
            &request.columns,
            Ok(()),
            transactional,
            counts,
        )),
    }
}

pub async fn finish_failure(
    writer: BatchWriter,
    failure: Failure,
    columns: &[String],
) -> CsvImportOutcome {
    let transactional = writer.transactional();
    let counts = writer.counts();
    let cancelled = super::execution::cancellation_token().is_cancelled();
    let rollback = writer.abort().await;
    if cancelled && transactional {
        return CsvImportOutcome {
            inserted_rows: 0,
            updated_rows: 0,
            skipped_rows: 0,
            failed_row: None,
            failed_column: None,
            error: Some(match rollback {
                Ok(()) => "Import vom Benutzer abgebrochen und zurückgerollt.".into(),
                Err(_) => {
                    "Abbruch angefordert, Rollback nicht bestätigt. Serverzustand prüfen.".into()
                }
            }),
        };
    }
    failure_outcome(failure, columns, rollback, transactional, counts)
}

pub async fn import(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool: PoolState,
    request: &CsvImportRequest,
) -> Result<CsvImportOutcome, String> {
    let dialect = Dialect::from_kind(kind)
        .ok_or("Dateiimport wird für diesen Datenbanktyp nicht unterstützt.")?;
    validate_request(request)?;
    let adapter =
        super::create_adapter_from_string(kind, connection_string, database, pool.clone())?;
    let plan = prepare_plan(
        dialect,
        adapter.as_ref(),
        &request.schema,
        &request.table,
        &request.columns,
        request.conflict.as_ref(),
    )
    .await?;
    let session = open_session(kind, connection_string, database, pool).await?;
    run_import(plan, session, request).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn column(name: &str, data_type: &str) -> ImportColumnInfo {
        ImportColumnInfo {
            name: name.into(),
            data_type: data_type.into(),
            is_nullable: true,
            has_default: false,
            is_identity: false,
            is_generated: false,
            ordinal_position: 1,
        }
    }

    fn plan(dialect: Dialect, conflict: Option<ConflictPlan>) -> ImportPlan {
        ImportPlan {
            dialect,
            target: dialect.target("s", "t"),
            columns: vec![column("id", "int"), column("name", "varchar(20)")],
            conflict,
            identity_insert: false,
        }
    }

    fn rows(plan: &ImportPlan) -> Vec<Vec<String>> {
        vec![
            plan.row_literals(&[Some("1".into()), Some("a'b".into())]),
            plan.row_literals(&[Some("2".into()), None]),
        ]
    }

    fn upsert() -> Option<ConflictPlan> {
        Some(ConflictPlan {
            constraint: "t_pkey".into(),
            keys: vec!["id".into()],
            updates: vec!["name".into()],
        })
    }

    #[test]
    fn classifies_types_across_families() {
        assert_eq!(classify("bigint"), TypeClass::Integer);
        assert_eq!(classify("Nullable(Int32)"), TypeClass::Integer);
        assert_eq!(classify("UInt64"), TypeClass::Integer);
        assert_eq!(classify("interval"), TypeClass::Text);
        assert_eq!(classify("tinyint(1)"), TypeClass::Bool);
        assert_eq!(classify("bit"), TypeClass::Bool);
        assert_eq!(classify("NUMBER"), TypeClass::Decimal);
        assert_eq!(classify("decimal(10,2)"), TypeClass::Decimal);
        assert_eq!(
            classify("TIMESTAMP(6) WITH TIME ZONE"),
            TypeClass::TimestampTz
        );
        assert_eq!(classify("datetime2"), TypeClass::Timestamp);
        assert_eq!(classify("DATE"), TypeClass::Date);
        assert_eq!(classify("varbinary(16)"), TypeClass::Binary);
        assert_eq!(classify("BLOB"), TypeClass::Binary);
        assert_eq!(classify("nvarchar(50)"), TypeClass::Text);
        assert_eq!(classify("integer[]"), TypeClass::Text);
    }

    #[test]
    fn literals_follow_dialect_rules() {
        assert_eq!(literal(Dialect::Mysql, "int", Some(" 42 ")), "42");
        assert_eq!(literal(Dialect::Mysql, "int", Some("4x")), "'4x'");
        assert_eq!(literal(Dialect::Mysql, "text", Some("a\\'b")), "'a\\\\''b'");
        assert_eq!(
            literal(Dialect::Clickhouse, "String", Some("a'b")),
            "'a\\'b'"
        );
        assert_eq!(literal(Dialect::Mssql, "nvarchar(5)", Some("ä'")), "N'ä'''");
        assert_eq!(literal(Dialect::Mssql, "bit", Some("ja")), "1");
        assert_eq!(literal(Dialect::Duckdb, "BOOLEAN", Some("false")), "FALSE");
        assert_eq!(literal(Dialect::Sqlite, "blob", Some("\\xDEAD")), "X'dead'");
        assert_eq!(
            literal(Dialect::Mssql, "varbinary(4)", Some("0xbeef")),
            "0xbeef"
        );
        assert_eq!(
            literal(Dialect::Oracle, "RAW", Some("\\xab")),
            "HEXTORAW('ab')"
        );
        assert_eq!(
            literal(Dialect::Oracle, "DATE", Some("2024-01-02")),
            "TIMESTAMP '2024-01-02 00:00:00.000000'"
        );
        assert_eq!(
            literal(
                Dialect::Oracle,
                "TIMESTAMP(6) WITH TIME ZONE",
                Some("2024-01-02T03:04:05+02:00")
            ),
            "TIMESTAMP '2024-01-02 03:04:05.000000 +02:00'"
        );
        assert_eq!(
            literal(Dialect::Mssql, "datetime", Some("2024-01-02 03:04:05.5")),
            "CAST('2024-01-02T03:04:05.500' AS datetime2)"
        );
        assert_eq!(literal(Dialect::Postgres, "integer", Some("7")), "'7'");
        assert_eq!(literal(Dialect::Oracle, "VARCHAR2(10)", None), "NULL");
        let long = "x".repeat(3500);
        let clob = literal(Dialect::Oracle, "CLOB", Some(&long));
        assert_eq!(clob.matches("TO_CLOB(").count(), 4);
    }

    #[test]
    fn plain_inserts_are_multi_row() {
        let mysql = plan(Dialect::Mysql, None);
        assert_eq!(
            mysql.insert_sql(&rows(&mysql)),
            "INSERT INTO `s`.`t` (`id`, `name`) VALUES (1, 'a''b'), (2, NULL)"
        );
        let oracle = plan(Dialect::Oracle, None);
        assert_eq!(
            oracle.insert_sql(&rows(&oracle)),
            "INSERT INTO \"s\".\"t\" (\"id\", \"name\") SELECT 1 AS \"id\", 'a''b' AS \"name\" FROM DUAL UNION ALL SELECT 2, NULL FROM DUAL"
        );
        let pg = plan(Dialect::Postgres, None);
        assert!(pg
            .insert_sql(&rows(&pg))
            .ends_with("VALUES ('1', 'a''b'), ('2', NULL) RETURNING (xmax = 0)"));
    }

    #[test]
    fn conflict_statements_per_dialect() {
        let mysql = plan(Dialect::Mysql, upsert());
        assert!(mysql
            .insert_sql(&rows(&mysql))
            .ends_with("ON DUPLICATE KEY UPDATE `name` = VALUES(`name`)"));
        let mut skip = upsert();
        skip.as_mut().unwrap().updates.clear();
        let mysql_skip = plan(Dialect::Mysql, skip.clone());
        assert!(mysql_skip
            .insert_sql(&rows(&mysql_skip))
            .ends_with("ON DUPLICATE KEY UPDATE `id` = `id`"));
        let sqlite = plan(Dialect::Sqlite, upsert());
        assert!(sqlite
            .insert_sql(&rows(&sqlite))
            .ends_with("ON CONFLICT (\"id\") DO UPDATE SET \"name\" = excluded.\"name\""));
        let duck = plan(Dialect::Duckdb, skip.clone());
        assert!(duck
            .insert_sql(&rows(&duck))
            .ends_with("ON CONFLICT (\"id\") DO NOTHING"));
        let mssql = plan(Dialect::Mssql, upsert());
        assert_eq!(
            mssql.insert_sql(&rows(&mssql)),
            "MERGE INTO [s].[t] AS d USING (VALUES (1, N'a''b'), (2, NULL)) AS s ([id], [name]) ON (d.[id] = s.[id]) WHEN MATCHED THEN UPDATE SET d.[name] = s.[name] WHEN NOT MATCHED THEN INSERT ([id], [name]) VALUES (s.[id], s.[name]);"
        );
        let oracle = plan(Dialect::Oracle, skip);
        let sql = oracle.insert_sql(&rows(&oracle));
        assert!(sql.starts_with("MERGE INTO \"s\".\"t\" d USING (SELECT 1 AS \"id\""));
        assert!(!sql.contains("WHEN MATCHED"));
        let pg = plan(Dialect::Postgres, upsert());
        assert!(pg.insert_sql(&rows(&pg)).contains(
            "ON CONFLICT ON CONSTRAINT \"t_pkey\" DO UPDATE SET \"name\" = EXCLUDED.\"name\" RETURNING"
        ));
    }

    #[test]
    fn existing_key_count_skips_null_keys() {
        let mssql = plan(Dialect::Mssql, upsert());
        let mut batch = rows(&mssql);
        batch.push(mssql.row_literals(&[None, Some("x".into())]));
        assert_eq!(
            mssql.existing_count_sql(&batch).unwrap(),
            "SELECT COUNT(*) AS n FROM [s].[t] WHERE [id] IN (1, 2)"
        );
        assert_eq!(
            mssql.existing_count_sql(&batch[2..]).unwrap(),
            String::new()
        );
        assert!(plan(Dialect::Mssql, None)
            .existing_count_sql(&batch)
            .is_none());
        let mut composite = plan(Dialect::Sqlite, upsert());
        composite.conflict.as_mut().unwrap().keys = vec!["id".into(), "name".into()];
        assert_eq!(
            composite.existing_count_sql(&rows(&composite)).unwrap(),
            "SELECT COUNT(*) AS n FROM \"s\".\"t\" WHERE (\"id\", \"name\") IN (VALUES (1, 'a''b'))"
        );
        composite.dialect = Dialect::Mssql;
        assert!(composite
            .existing_count_sql(&rows(&composite))
            .unwrap()
            .ends_with("WHERE ([id] = 1 AND [name] = N'a''b')"));
    }

    struct Recorder {
        log: Arc<std::sync::Mutex<Vec<String>>>,
        fail_on: Option<&'static str>,
    }

    #[async_trait]
    impl TxSession for Recorder {
        async fn execute(&mut self, sql: &str) -> Result<QueryResult, String> {
            self.log.lock().unwrap().push(sql.to_string());
            if self.fail_on.is_some_and(|needle| sql.contains(needle)) {
                return Err("boom".into());
            }
            Ok(QueryResult {
                columns: vec!["n".into()],
                rows: if sql.starts_with("SELECT COUNT") {
                    vec![serde_json::json!({"n": 1})]
                } else {
                    vec![]
                },
                rows_affected: None,
                execution_time_ms: 0,
            })
        }
        async fn commit(&mut self) -> Result<(), String> {
            self.log.lock().unwrap().push("COMMIT".into());
            Ok(())
        }
        async fn rollback(&mut self) -> Result<(), String> {
            self.log.lock().unwrap().push("ROLLBACK".into());
            Ok(())
        }
    }

    #[tokio::test]
    async fn writer_splits_duplicate_keys_and_counts_existing_rows() {
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut writer = BatchWriter::new(
            plan(Dialect::Sqlite, upsert()),
            Box::new(Recorder {
                log: log.clone(),
                fail_on: None,
            }),
        );
        for (id, name) in [("1", "a"), ("2", "b"), ("1", "c")] {
            writer
                .push(vec![Some(id.into()), Some(name.into())])
                .await
                .ok()
                .unwrap();
        }
        let counts = writer.commit().await.ok().unwrap();
        assert_eq!((counts.inserted, counts.updated, counts.skipped), (1, 2, 0));
        let log = log.lock().unwrap();
        assert_eq!(
            log.iter().filter(|sql| sql.starts_with("INSERT")).count(),
            2
        );
        assert_eq!(log.last().unwrap(), "COMMIT");
    }

    #[tokio::test]
    async fn writer_locates_failing_row_via_savepoint() {
        let log = Arc::new(std::sync::Mutex::new(Vec::new()));
        let mut writer = BatchWriter::new(
            plan(Dialect::Mysql, None),
            Box::new(Recorder {
                log: log.clone(),
                fail_on: Some("'bad'"),
            }),
        );
        for name in ["a", "b", "bad", "c"] {
            writer
                .push(vec![Some("1".into()), Some(name.into())])
                .await
                .ok()
                .unwrap();
        }
        let failure = writer.flush().await.err().unwrap();
        assert_eq!(failure.row, Some(3));
        let outcome = finish_failure(writer, failure, &["id".into(), "name".into()]).await;
        assert!(outcome.error.unwrap().contains("vollständig zurückgerollt"));
        assert_eq!(outcome.inserted_rows, 0);
        assert!(log
            .lock()
            .unwrap()
            .contains(&"ROLLBACK TO SAVEPOINT l8db_import".to_string()));
    }
}
