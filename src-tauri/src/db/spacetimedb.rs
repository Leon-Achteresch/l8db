use async_trait::async_trait;
use reqwest::Method;
use serde::Serialize;
use serde_json::Value;
use std::cmp::Ordering;

use super::{
    rows_to_objects, unique_column_names, where_clause, ColumnInfo, DatabaseAdapter, QueryResult,
    TableData, TableInfo,
};
use crate::cloud_accounts::http::{self as cloud_http, Auth, Body};

pub(crate) const MAINCLOUD: &str = "https://maincloud.spacetimedb.com/";
pub(crate) const SCHEMA_NAME: &str = "main";
pub(crate) const MAX_ROWS: usize = 10_000;
const SCHEMA_LIMIT: usize = 8 * 1024 * 1024;
const SQL_LIMIT: usize = 16 * 1024 * 1024;
const INFO_LIMIT: usize = 256 * 1024;
const LABEL: &str = "SpacetimeDB";

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Target {
    pub base: url::Url,
    pub database: String,
    pub token: String,
}

impl Target {
    pub(crate) fn auth(&self) -> Auth {
        if self.token.is_empty() {
            Auth::None
        } else {
            Auth::Bearer(self.token.clone())
        }
    }
}

fn decode(value: &str) -> String {
    percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map(|value| value.into_owned())
        .unwrap_or_else(|_| value.to_string())
}

pub(crate) fn validate_database(name: &str) -> Result<&str, String> {
    let name = name.trim();
    if name.is_empty()
        || name.len() > 256
        || name.contains('/')
        || name.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Ungültiger SpacetimeDB-Datenbankname.".into());
    }
    Ok(name)
}

pub(crate) fn base_for_host(
    host: &url::Host<&str>,
    port: Option<u16>,
    insecure: bool,
) -> Result<url::Url, String> {
    let loopback = cloud_http::is_loopback(host);
    if insecure && !loopback {
        return Err(
            "Unverschlüsselte SpacetimeDB-Verbindungen (tls=false) sind nur zu lokalen Servern erlaubt."
                .into(),
        );
    }
    let host = match host {
        url::Host::Ipv6(ip) => format!("[{ip}]"),
        url::Host::Ipv4(ip) => ip.to_string(),
        url::Host::Domain(domain) => domain.to_string(),
    };
    let port = port.map(|port| format!(":{port}")).unwrap_or_default();
    let scheme = if insecure { "http" } else { "https" };
    url::Url::parse(&format!("{scheme}://{host}{port}/"))
        .map_err(|_| "Ungültiger SpacetimeDB-Host.".to_string())
}

pub(crate) fn parse_connection(raw: &str, database: Option<&str>) -> Result<Target, String> {
    let url = url::Url::parse(raw.trim()).map_err(|_| {
        "Ungültige SpacetimeDB-URL. Erwartet: spacetimedb://token@maincloud.spacetimedb.com/datenbank"
            .to_string()
    })?;
    if url.scheme() != "spacetimedb" {
        return Err("Eine spacetimedb:// URL ist erforderlich.".into());
    }
    let host = url
        .host()
        .filter(|host| !matches!(host, url::Host::Domain(domain) if domain.is_empty()))
        .ok_or("Die SpacetimeDB-URL braucht einen Host.")?;
    let mut insecure = false;
    for (key, value) in url.query_pairs() {
        match key.as_ref() {
            "tls" => insecure = matches!(value.as_ref(), "false" | "0" | "off"),
            "token" | "auth_token" | "authToken" => return Err(
                "Das Token gehört nicht in die URL-Query. Es wird im Schlüsselbund gespeichert."
                    .into(),
            ),
            _ => {}
        }
    }
    let base = base_for_host(&host, url.port(), insecure)?;
    let from_path = decode(url.path().trim_matches('/'));
    let database = database
        .map(str::trim)
        .filter(|name| !name.is_empty() && *name != SCHEMA_NAME)
        .map(str::to_string)
        .unwrap_or(from_path);
    let database = validate_database(&database)?.to_string();
    Ok(Target {
        base,
        database,
        token: decode(url.password().unwrap_or("")),
    })
}

pub(crate) fn quote_large_integers(text: &str) -> std::borrow::Cow<'_, str> {
    let bytes = text.as_bytes();
    let mut out: Option<String> = None;
    let mut in_string = false;
    let mut escaped = false;
    let mut copied = 0;
    let mut index = 0;
    while index < bytes.len() {
        let byte = bytes[index];
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            index += 1;
            continue;
        }
        if byte == b'"' {
            in_string = true;
            index += 1;
            continue;
        }
        if byte == b'-' || byte.is_ascii_digit() {
            let start = index;
            index += 1;
            while index < bytes.len()
                && (bytes[index].is_ascii_digit()
                    || matches!(bytes[index], b'.' | b'e' | b'E' | b'+' | b'-'))
            {
                index += 1;
            }
            let token = &text[start..index];
            let digits = token.trim_start_matches('-');
            if digits.len() > 15 && digits.bytes().all(|b| b.is_ascii_digit()) {
                let buffer = out.get_or_insert_with(|| String::with_capacity(text.len() + 16));
                buffer.push_str(&text[copied..start]);
                buffer.push('"');
                buffer.push_str(token);
                buffer.push('"');
                copied = index;
            }
            continue;
        }
        index += 1;
    }
    match out {
        Some(mut buffer) => {
            buffer.push_str(&text[copied..]);
            std::borrow::Cow::Owned(buffer)
        }
        None => std::borrow::Cow::Borrowed(text),
    }
}

pub(crate) fn parse_json(body: &[u8]) -> Result<Value, String> {
    let text = std::str::from_utf8(body)
        .map_err(|_| "SpacetimeDB hat keine gültige UTF-8-Antwort geliefert.".to_string())?;
    serde_json::from_str(&quote_large_integers(text))
        .map_err(|_| "SpacetimeDB hat unerwartete Daten geliefert.".to_string())
}

fn single_entry(value: &Value) -> Option<(&str, &Value)> {
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    object
        .iter()
        .next()
        .map(|(key, value)| (key.as_str(), value))
}

pub(crate) fn element_name(element: &Value) -> Option<String> {
    match &element["name"] {
        Value::String(name) => Some(name.clone()),
        value => match single_entry(value) {
            Some(("some", Value::String(name))) => Some(name.clone()),
            _ => None,
        },
    }
}

fn special_product(elements: &[Value]) -> Option<&'static str> {
    if elements.len() != 1 {
        return None;
    }
    match element_name(&elements[0])?.as_str() {
        "__identity__" => Some("Identity"),
        "__connection_id__" => Some("ConnectionId"),
        "__timestamp_micros_since_unix_epoch__" => Some("Timestamp"),
        "__time_duration_micros__" => Some("TimeDuration"),
        "__uuid__" => Some("Uuid"),
        _ => None,
    }
}

fn variants(sum: &Value) -> Vec<(String, &Value)> {
    sum["variants"]
        .as_array()
        .map(|variants| {
            variants
                .iter()
                .map(|variant| {
                    (
                        element_name(variant).unwrap_or_default(),
                        &variant["algebraic_type"],
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn type_name(ty: &Value, types: &[Value], depth: usize) -> String {
    if depth > 8 {
        return "…".into();
    }
    let Some((tag, inner)) = single_entry(ty) else {
        return "Unbekannt".into();
    };
    match tag {
        "Ref" => inner
            .as_u64()
            .and_then(|index| types.get(index as usize))
            .map(|resolved| type_name(resolved, types, depth + 1))
            .unwrap_or_else(|| "Ref".into()),
        "Array" => format!("Array<{}>", type_name(inner, types, depth + 1)),
        "Product" => {
            let elements = inner["elements"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[]);
            if let Some(special) = special_product(elements) {
                return special.into();
            }
            let fields = elements
                .iter()
                .take(6)
                .map(|element| {
                    format!(
                        "{}: {}",
                        element_name(element).unwrap_or_else(|| "_".into()),
                        type_name(&element["algebraic_type"], types, depth + 1)
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            let more = if elements.len() > 6 { ", …" } else { "" };
            format!("Product{{{fields}{more}}}")
        }
        "Sum" => {
            let variants = variants(inner);
            let names: Vec<&str> = variants.iter().map(|(name, _)| name.as_str()).collect();
            if names == ["some", "none"] {
                return format!("Option<{}>", type_name(variants[0].1, types, depth + 1));
            }
            if names == ["ok", "err"] {
                return format!(
                    "Result<{}, {}>",
                    type_name(variants[0].1, types, depth + 1),
                    type_name(variants[1].1, types, depth + 1)
                );
            }
            let shown = names
                .iter()
                .take(6)
                .copied()
                .collect::<Vec<_>>()
                .join(" | ");
            let more = if names.len() > 6 { " | …" } else { "" };
            format!("Enum({shown}{more})")
        }
        scalar => scalar.to_string(),
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct ColumnDef {
    pub name: String,
    pub type_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct TableDef {
    pub name: String,
    pub columns: Vec<ColumnDef>,
    pub public: bool,
    pub system: bool,
    pub primary_key: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct ReducerDef {
    pub name: String,
    pub params: Vec<ColumnDef>,
    pub lifecycle: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub(crate) struct ModuleSchema {
    pub tables: Vec<TableDef>,
    pub reducers: Vec<ReducerDef>,
}

fn columns_of(elements: &Value, types: &[Value]) -> Vec<ColumnDef> {
    elements
        .as_array()
        .map(|elements| {
            elements
                .iter()
                .enumerate()
                .map(|(index, element)| ColumnDef {
                    name: element_name(element).unwrap_or_else(|| format!("spalte_{index}")),
                    type_name: type_name(&element["algebraic_type"], types, 0),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn tag_of(value: &Value) -> Option<&str> {
    single_entry(value).map(|(tag, _)| tag)
}

fn text_name(value: &Value) -> Option<String> {
    match value {
        Value::String(name) => Some(name.clone()),
        other => match single_entry(other) {
            Some(("some", Value::String(name))) => Some(name.clone()),
            _ => None,
        },
    }
}

pub(crate) fn parse_module(value: &Value) -> Result<ModuleSchema, String> {
    let types = value
        .pointer("/typespace/types")
        .and_then(Value::as_array)
        .ok_or("SpacetimeDB-Schema ohne Typespace: Modulversion wird nicht unterstützt.")?;
    let tables = value["tables"]
        .as_array()
        .ok_or("SpacetimeDB-Schema ohne Tabellenliste: Modulversion wird nicht unterstützt.")?;
    let mut parsed = Vec::with_capacity(tables.len());
    for table in tables {
        let Some(name) = text_name(&table["name"]) else {
            continue;
        };
        let product = table["product_type_ref"]
            .as_u64()
            .and_then(|index| types.get(index as usize));
        let columns = match product.and_then(single_entry) {
            Some(("Product", product)) => columns_of(&product["elements"], types),
            _ => Vec::new(),
        };
        let primary_key = table["primary_key"]
            .as_array()
            .map(|keys| {
                keys.iter()
                    .filter_map(Value::as_u64)
                    .filter_map(|index| columns.get(index as usize).map(|c| c.name.clone()))
                    .collect()
            })
            .unwrap_or_default();
        parsed.push(TableDef {
            name,
            public: tag_of(&table["table_access"]) == Some("Public"),
            system: tag_of(&table["table_type"]) == Some("System"),
            columns,
            primary_key,
        });
    }
    parsed.sort_by(|left, right| left.name.cmp(&right.name));
    let reducers = value["reducers"]
        .as_array()
        .map(|reducers| {
            reducers
                .iter()
                .filter_map(|reducer| {
                    Some(ReducerDef {
                        name: text_name(&reducer["name"])?,
                        params: columns_of(&reducer["params"]["elements"], types),
                        lifecycle: match single_entry(&reducer["lifecycle"]) {
                            Some(("some", inner)) => tag_of(inner).map(str::to_string),
                            _ => None,
                        },
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ModuleSchema {
        tables: parsed,
        reducers,
    })
}

fn unwrap_single(value: Value) -> Value {
    match value {
        Value::Array(mut items) if items.len() == 1 => items.remove(0),
        other => other,
    }
}

pub(crate) fn cell(value: Value, type_name: &str) -> Value {
    if let Some(inner) = type_name
        .strip_prefix("Option<")
        .and_then(|rest| rest.strip_suffix('>'))
    {
        return match value {
            Value::Array(mut fields) if fields.len() == 2 => {
                match fields.first().and_then(Value::as_u64) {
                    Some(0) => cell(fields.remove(1), inner),
                    Some(1) => Value::Null,
                    _ => Value::Array(fields),
                }
            }
            Value::Object(mut object) if object.len() == 1 => {
                if let Some(some) = object.remove("some").or_else(|| object.remove("0")) {
                    cell(some, inner)
                } else {
                    Value::Null
                }
            }
            other => other,
        };
    }
    if let Some(names) = type_name
        .strip_prefix("Enum(")
        .and_then(|name| name.strip_suffix(')'))
    {
        if let Value::Array(fields) = &value {
            if fields.len() == 2 {
                if let Some(name) = fields[0]
                    .as_u64()
                    .and_then(|tag| names.split(" | ").nth(tag as usize))
                    .filter(|name| *name != "…")
                {
                    if fields[1].as_array().is_some_and(Vec::is_empty) {
                        return Value::String(name.into());
                    }
                    return serde_json::json!({ (name): fields[1].clone() });
                }
            }
        }
    }
    match type_name {
        "Identity" | "ConnectionId" | "Uuid" | "TimeDuration" => unwrap_single(value),
        "Timestamp" => {
            let micros = unwrap_single(value);
            let parsed = match &micros {
                Value::Number(number) => number.as_i64(),
                Value::String(text) => text.parse::<i64>().ok(),
                _ => None,
            };
            parsed
                .and_then(chrono::DateTime::<chrono::Utc>::from_timestamp_micros)
                .map(|stamp| Value::String(stamp.to_rfc3339()))
                .unwrap_or(micros)
        }
        _ => value,
    }
}

#[cfg(test)]
#[path = "spacetimedb_live_tests.rs"]
mod live_tests;

#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct Statement {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
}

pub(crate) fn parse_statements(value: Value) -> Result<Vec<Statement>, String> {
    let list = match value {
        Value::Array(list) => list,
        object @ Value::Object(_) => vec![object],
        _ => return Err("SpacetimeDB hat unerwartete SQL-Daten geliefert.".into()),
    };
    let mut statements = Vec::with_capacity(list.len());
    for mut statement in list {
        let elements = statement["schema"]["elements"].take();
        let columns = columns_of(&elements, &[]);
        let names: Vec<String> = columns.iter().map(|column| column.name.clone()).collect();
        let types: Vec<String> = columns.into_iter().map(|column| column.type_name).collect();
        let rows = match statement["rows"].take() {
            Value::Array(rows) => rows
                .into_iter()
                .map(|row| match row {
                    Value::Array(cells) => cells
                        .into_iter()
                        .enumerate()
                        .map(|(index, value)| {
                            cell(value, types.get(index).map(String::as_str).unwrap_or(""))
                        })
                        .collect(),
                    other => vec![other],
                })
                .collect(),
            _ => Vec::new(),
        };
        statements.push(Statement {
            columns: names,
            rows,
        });
    }
    Ok(statements)
}

pub(crate) async fn module_schema(target: &Target) -> Result<ModuleSchema, String> {
    let url = cloud_http::endpoint(
        &target.base,
        &["v1", "database", &target.database, "schema"],
        &[("version", "9".into())],
    )?;
    let reply = cloud_http::send(
        LABEL,
        &target.auth(),
        Method::GET,
        url,
        Body::Empty,
        SCHEMA_LIMIT,
    )
    .await?;
    parse_module(&parse_json(&reply.body)?)
}

pub(crate) async fn database_info(target: &Target) -> Result<Value, String> {
    let url = cloud_http::endpoint(&target.base, &["v1", "database", &target.database], &[])?;
    let reply = cloud_http::send(
        LABEL,
        &target.auth(),
        Method::GET,
        url,
        Body::Empty,
        INFO_LIMIT,
    )
    .await?;
    parse_json(&reply.body)
}

pub(crate) async fn run_sql(target: &Target, sql: &str) -> Result<Vec<Statement>, String> {
    let url = cloud_http::endpoint(
        &target.base,
        &["v1", "database", &target.database, "sql"],
        &[],
    )?;
    let reply = cloud_http::send(
        LABEL,
        &target.auth(),
        Method::POST,
        url,
        Body::Text(sql.to_string()),
        SQL_LIMIT,
    )
    .await
    .map_err(|error| {
        if error.status.is_none() && error.message.contains("größer als") {
            format!("{} Bitte ein kleineres LIMIT verwenden.", error.message)
        } else {
            error.message
        }
    })?;
    parse_statements(parse_json(&reply.body)?)
}

pub(crate) fn quote(identifier: &str) -> Result<String, String> {
    if identifier.is_empty() || identifier.len() > 256 || identifier.contains('\0') {
        return Err("Ungültiger SpacetimeDB-Bezeichner.".into());
    }
    let plain = identifier
        .chars()
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
        && identifier
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_');
    Ok(if plain {
        identifier.to_string()
    } else {
        format!("\"{}\"", identifier.replace('"', "\"\""))
    })
}

pub(crate) fn read_only_select(sql: &str) -> Result<String, String> {
    let mut statement = sql.trim();
    while let Some(rest) = statement.strip_suffix(';') {
        statement = rest.trim_end();
    }
    if super::sql_script::split_dialect(statement, super::sql_script::Dialect::Standard).len() != 1
    {
        return Err("SpacetimeDB: Bitte genau eine Abfrage ausführen.".into());
    }
    let first = statement
        .split(|c: char| c.is_whitespace() || c == '(')
        .find(|word| !word.is_empty())
        .unwrap_or("");
    if !first.eq_ignore_ascii_case("select") {
        return Err(
            "SpacetimeDB-Verbindungen sind lesend: nur SELECT ist erlaubt. Schreibzugriffe laufen über Reducer im Bereich Cloud-Konten."
                .into(),
        );
    }
    Ok(statement.to_string())
}

fn compare(left: &Value, right: &Value) -> Ordering {
    match (left, right) {
        (Value::Null, Value::Null) => Ordering::Equal,
        (Value::Null, _) => Ordering::Less,
        (_, Value::Null) => Ordering::Greater,
        (Value::Number(a), Value::Number(b)) => a
            .as_f64()
            .partial_cmp(&b.as_f64())
            .unwrap_or(Ordering::Equal),
        (Value::Bool(a), Value::Bool(b)) => a.cmp(b),
        (Value::String(a), Value::String(b)) => match (a.parse::<i128>(), b.parse::<i128>()) {
            (Ok(x), Ok(y)) => x.cmp(&y),
            _ => a.cmp(b),
        },
        (a, b) => a.to_string().cmp(&b.to_string()),
    }
}

pub(crate) fn sort_rows(rows: &mut [Vec<Value>], column: usize, descending: bool) {
    rows.sort_by(|left, right| {
        let ordering = compare(
            left.get(column).unwrap_or(&Value::Null),
            right.get(column).unwrap_or(&Value::Null),
        );
        if descending {
            ordering.reverse()
        } else {
            ordering
        }
    });
}

pub struct SpacetimeAdapter {
    target: Target,
}

impl SpacetimeAdapter {
    pub fn new(connection_string: &str, database: Option<&str>) -> Result<Self, String> {
        Ok(Self {
            target: parse_connection(connection_string, database)?,
        })
    }

    async fn select(&self, sql: &str) -> Result<Statement, String> {
        run_sql(&self.target, sql)
            .await?
            .into_iter()
            .rev()
            .find(|statement| !statement.columns.is_empty())
            .ok_or_else(|| "SpacetimeDB hat keine Ergebniszeilen geliefert.".to_string())
    }

    async fn user_tables(&self) -> Result<Vec<TableDef>, String> {
        Ok(module_schema(&self.target)
            .await?
            .tables
            .into_iter()
            .filter(|table| !table.system)
            .collect())
    }
}

#[async_trait]
impl DatabaseAdapter for SpacetimeAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        database_info(&self.target).await.map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(vec![self.target.database.clone()])
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec![SCHEMA_NAME.to_string()])
    }

    async fn list_tables(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(self
            .user_tables()
            .await?
            .into_iter()
            .map(|table| TableInfo {
                schema: SCHEMA_NAME.to_string(),
                name: table.name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        _schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        Ok(self
            .user_tables()
            .await?
            .into_iter()
            .filter(|candidate| table.is_none_or(|name| candidate.name == name))
            .flat_map(|candidate| {
                let table = candidate.name;
                candidate.columns.into_iter().map(move |column| ColumnInfo {
                    schema: SCHEMA_NAME.to_string(),
                    table: table.clone(),
                    name: column.name,
                    data_type: column.type_name,
                })
            })
            .collect())
    }

    async fn fetch_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        _is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let limit = limit.clamp(1, MAX_ROWS as i64) as usize;
        let offset = offset.max(0) as usize;
        let base = format!(
            "SELECT * FROM {}{}",
            quote(table)?,
            where_clause(filter, allow_raw_filter)?
        );
        let order = order_by.map(str::trim).filter(|column| !column.is_empty());
        let window = if order.is_some() {
            MAX_ROWS + 1
        } else {
            let window = offset.saturating_add(limit);
            if window > MAX_ROWS {
                return Err(format!(
                    "SpacetimeDB-SQL kennt kein OFFSET: Blättern ist bis Zeile {MAX_ROWS} möglich. Bitte filtern."
                ));
            }
            window
        };
        let statement = self.select(&format!("{base} LIMIT {window}")).await?;
        let columns = unique_column_names(statement.columns);
        let mut rows = statement.rows;
        if let Some(order) = order {
            if rows.len() > MAX_ROWS {
                return Err(format!(
                    "Sortieren ist bei SpacetimeDB nur für Ergebnisse bis {MAX_ROWS} Zeilen möglich. Bitte filtern."
                ));
            }
            let column = columns
                .iter()
                .position(|name| name == order)
                .ok_or_else(|| format!("Spalte {order} nicht gefunden."))?;
            sort_rows(&mut rows, column, order_desc);
        }
        let rows: Vec<Vec<Value>> = rows.into_iter().skip(offset).take(limit).collect();
        Ok(TableData {
            rows: rows_to_objects(&columns, rows),
            columns,
        })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let statement = self
            .select(&format!(
                "SELECT COUNT(*) AS n FROM {}{}",
                quote(table)?,
                where_clause(filter, allow_raw_filter)?
            ))
            .await?;
        let value = statement
            .rows
            .first()
            .and_then(|row| row.first())
            .cloned()
            .unwrap_or(Value::Null);
        match value {
            Value::Number(number) => number
                .as_i64()
                .ok_or_else(|| "SpacetimeDB hat eine ungültige Anzahl geliefert.".to_string()),
            Value::String(text) => text
                .parse::<i64>()
                .map_err(|_| "SpacetimeDB hat eine ungültige Anzahl geliefert.".to_string()),
            _ => Err("SpacetimeDB hat keine Anzahl geliefert.".into()),
        }
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let started = std::time::Instant::now();
        let statement = self.select(&read_only_select(sql)?).await?;
        let columns = unique_column_names(statement.columns);
        let cap = super::execution::result_row_cap(MAX_ROWS);
        let truncated = statement.rows.len() > cap;
        let rows: Vec<Vec<Value>> = statement.rows.into_iter().take(cap).collect();
        Ok(QueryResult {
            rows: rows_to_objects(&columns, rows),
            columns,
            rows_affected: None,
            execution_time_ms: started.elapsed().as_millis() as u64,
            truncated,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::http_mock;
    use serde_json::json;

    fn local(base: &str, db: &str) -> String {
        let address = base.trim_start_matches("http://");
        format!("spacetimedb://token:geheim@{address}/{db}?tls=false")
    }

    fn schema_json() -> Value {
        json!({
            "typespace": {"types": [
                {"Product": {"elements": [
                    {"name": {"some": "id"}, "algebraic_type": {"U64": []}},
                    {"name": {"some": "owner"}, "algebraic_type": {"Product": {"elements": [
                        {"name": {"some": "__identity__"}, "algebraic_type": {"U256": []}}
                    ]}}},
                    {"name": {"some": "nick"}, "algebraic_type": {"Sum": {"variants": [
                        {"name": {"some": "some"}, "algebraic_type": {"String": []}},
                        {"name": {"some": "none"}, "algebraic_type": {"Product": {"elements": []}}}
                    ]}}},
                    {"name": {"some": "seen"}, "algebraic_type": {"Product": {"elements": [
                        {"name": {"some": "__timestamp_micros_since_unix_epoch__"}, "algebraic_type": {"I64": []}}
                    ]}}}
                ]}},
                {"Product": {"elements": [
                    {"name": {"some": "key"}, "algebraic_type": {"String": []}}
                ]}}
            ]},
            "tables": [
                {"name": "player", "product_type_ref": 0, "primary_key": [0], "table_type": {"User": []}, "table_access": {"Public": []}},
                {"name": "secret_state", "product_type_ref": 1, "primary_key": [], "table_type": {"User": []}, "table_access": {"Private": []}},
                {"name": "st_table", "product_type_ref": 1, "primary_key": [], "table_type": {"System": []}, "table_access": {"Public": []}}
            ],
            "reducers": [
                {"name": "set_nick", "params": {"elements": [{"name": {"some": "nick"}, "algebraic_type": {"String": []}}]}, "lifecycle": {"none": []}},
                {"name": "init", "params": {"elements": []}, "lifecycle": {"some": {"Init": []}}}
            ]
        })
    }

    #[test]
    fn connection_urls_keep_tokens_out_of_queries_and_restrict_plain_http_to_loopback() {
        let target = parse_connection(
            "spacetimedb://token:a%2Fb@maincloud.spacetimedb.com/quickstart",
            None,
        )
        .unwrap();
        assert_eq!(target.base.as_str(), MAINCLOUD);
        assert_eq!(target.database, "quickstart");
        assert_eq!(target.token, "a/b");
        let local =
            parse_connection("spacetimedb://token:t@127.0.0.1:3000/db?tls=false", None).unwrap();
        assert_eq!(local.base.as_str(), "http://127.0.0.1:3000/");
        assert!(parse_connection("spacetimedb://token:t@example.com/db?tls=false", None).is_err());
        assert!(parse_connection("spacetimedb://example.com/db?token=x", None).is_err());
        assert!(parse_connection("postgres://example.com/db", None).is_err());
        assert!(parse_connection("spacetimedb://token:t@example.com/", None).is_err());
        assert_eq!(
            parse_connection("spacetimedb://token:t@example.com/a", Some("b"))
                .unwrap()
                .database,
            "b"
        );
    }

    #[test]
    fn large_integers_become_strings_outside_of_json_strings() {
        let text = r#"[[1, 123456789012345678901234567890, -98765432109876543, "12345678901234567890", 1.5e3]]"#;
        let value: Value = serde_json::from_str(&quote_large_integers(text)).unwrap();
        assert_eq!(value[0][0], json!(1));
        assert_eq!(value[0][1], json!("123456789012345678901234567890"));
        assert_eq!(value[0][2], json!("-98765432109876543"));
        assert_eq!(value[0][3], json!("12345678901234567890"));
        assert_eq!(value[0][4], json!(1500.0));
        assert!(matches!(
            quote_large_integers("[1,2]"),
            std::borrow::Cow::Borrowed(_)
        ));
    }

    #[test]
    fn module_schema_resolves_special_types_reducers_and_unknown_versions() {
        let schema = parse_module(&schema_json()).unwrap();
        let player = &schema.tables[0];
        assert_eq!(player.name, "player");
        assert!(player.public);
        assert_eq!(player.primary_key, vec!["id".to_string()]);
        let types: Vec<&str> = player
            .columns
            .iter()
            .map(|c| c.type_name.as_str())
            .collect();
        assert_eq!(
            types,
            vec!["U64", "Identity", "Option<String>", "Timestamp"]
        );
        assert!(!schema.tables[1].public);
        assert!(schema.tables[2].system);
        assert_eq!(schema.reducers[0].params[0].name, "nick");
        assert_eq!(schema.reducers[1].lifecycle.as_deref(), Some("Init"));
        assert!(parse_module(&json!({"tables": []})).is_err());
    }

    #[test]
    fn cells_unwrap_identities_options_and_timestamps() {
        assert_eq!(cell(json!(["0xabc"]), "Identity"), json!("0xabc"));
        assert_eq!(cell(json!({"some": "x"}), "Option<String>"), json!("x"));
        assert_eq!(cell(json!({"none": []}), "Option<String>"), Value::Null);
        assert_eq!(
            cell(json!([0, "Nick 3"]), "Option<String>"),
            json!("Nick 3")
        );
        assert_eq!(cell(json!([1, []]), "Option<String>"), Value::Null);
        assert_eq!(
            cell(json!([0, [1, []]]), "Option<Option<String>>"),
            Value::Null
        );
        assert_eq!(
            cell(json!([0, []]), "Enum(active | inactive | pending)"),
            json!("active")
        );
        assert_eq!(
            cell(json!([2, []]), "Enum(active | inactive | pending)"),
            json!("pending")
        );
        assert_eq!(
            cell(json!([1, "detail"]), "Enum(ok | failed)"),
            json!({"failed": "detail"})
        );
        assert_eq!(
            cell(json!([6, []]), "Enum(a | b | c | d | e | f | …)"),
            json!([6, []])
        );
        assert_eq!(
            cell(json!([0]), "Timestamp"),
            json!("1970-01-01T00:00:00+00:00")
        );
        assert_eq!(cell(json!([1, 2]), "Array<U8>"), json!([1, 2]));
    }

    #[test]
    fn only_single_select_statements_pass_the_read_only_gate() {
        assert_eq!(
            read_only_select(" select * from t; ").unwrap(),
            "select * from t"
        );
        assert!(read_only_select("SELECT * FROM t WHERE name = 'a;b'").is_ok());
        assert!(read_only_select("DELETE FROM t").is_err());
        assert!(read_only_select("SELECT 1; DELETE FROM t").is_err());
        assert!(read_only_select("INSERT INTO t VALUES (1)").is_err());
        for sql in [
            "SELECT 1 /* ' */; DELETE FROM t /* ' */",
            "SELECT id FROM t -- '\n; DELETE FROM t -- '",
            "SELECT id FROM t /* ; ' \" */; SELECT id FROM t",
        ] {
            assert!(read_only_select(sql).is_err(), "{sql}");
        }
        assert!(read_only_select("SELECT id FROM t /* ; ' \" */").is_ok());
        assert!(read_only_select("SELECT id FROM t WHERE name = 'a'';b'").is_ok());
        assert_eq!(quote("player").unwrap(), "player");
        assert_eq!(quote("odd name").unwrap(), "\"odd name\"");
    }

    #[test]
    fn read_only_gate_large_sql_has_bounded_latency_and_retained_output() {
        let sql = format!(
            "SELECT id FROM customer WHERE name = '{}' /* ; ' \" */",
            "x".repeat(256 * 1024)
        );
        let mut samples = Vec::with_capacity(31);
        let mut maximum_retained = 0;
        for _ in 0..31 {
            let started = std::time::Instant::now();
            let output = read_only_select(std::hint::black_box(&sql)).unwrap();
            samples.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(output, sql);
            maximum_retained = maximum_retained.max(output.capacity());
        }
        samples.sort_by(f64::total_cmp);
        assert!(samples[15] < 50.0, "median {} ms", samples[15]);
        assert!(samples[29] < 100.0, "p95 {} ms", samples[29]);
        assert!(maximum_retained <= sql.len() + 16);
        eprintln!(
            "Spacetime SQL guard: {} bytes x31, median {:.3}ms p95 {:.3}ms, retained output {}B, no database requests or background work",
            sql.len(), samples[15], samples[29], maximum_retained
        );
    }

    #[tokio::test]
    async fn adapter_reads_schema_rows_counts_and_sorts_within_bounds() {
        let rows: Vec<Value> = (0..30)
            .map(|i| json!([30 - i, ["0x01"], {"some": format!("n{i}")}, [i * 1_000_000]]))
            .collect();
        let schema = schema_json();
        let server = http_mock::start(move |request| {
            match (request.method.as_str(), request.route()) {
            ("GET", "/v1/database/game/schema") => (200, schema.to_string().into_bytes()),
            ("GET", "/v1/database/game") => (200, br#"{"database_identity":"c0ffee"}"#.to_vec()),
            ("POST", "/v1/database/game/sql") if request.body.starts_with("SELECT COUNT(*)") => (
                200,
                json!([{"schema": {"elements": [{"name": {"some": "n"}, "algebraic_type": {"U64": []}}]}, "rows": [[30]]}])
                    .to_string()
                    .into_bytes(),
            ),
            ("POST", "/v1/database/game/sql") => {
                let limit: usize = request
                    .body
                    .rsplit(' ')
                    .next()
                    .and_then(|value| value.parse().ok())
                    .unwrap_or(0);
                let body = json!([{
                    "schema": {"elements": [
                        {"name": {"some": "id"}, "algebraic_type": {"U64": []}},
                        {"name": {"some": "owner"}, "algebraic_type": {"Product": {"elements": [{"name": {"some": "__identity__"}, "algebraic_type": {"U256": []}}]}}},
                        {"name": {"some": "nick"}, "algebraic_type": {"Sum": {"variants": [
                            {"name": {"some": "some"}, "algebraic_type": {"String": []}},
                            {"name": {"some": "none"}, "algebraic_type": {"Product": {"elements": []}}}
                        ]}}},
                        {"name": {"some": "seen"}, "algebraic_type": {"Product": {"elements": [{"name": {"some": "__timestamp_micros_since_unix_epoch__"}, "algebraic_type": {"I64": []}}]}}}
                    ]},
                    "rows": rows.iter().take(limit).cloned().collect::<Vec<_>>()
                }]);
                (200, body.to_string().into_bytes())
            }
            _ => (404, b"{}".to_vec()),
        }
        });
        let adapter = SpacetimeAdapter::new(&local(&server.base, "game"), None).unwrap();
        adapter.test_connection().await.unwrap();
        let tables = adapter.list_tables(None).await.unwrap();
        assert_eq!(
            tables.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
            vec!["player", "secret_state"]
        );
        let columns = adapter
            .list_columns(None, Some("player"), None)
            .await
            .unwrap();
        assert_eq!(columns.len(), 4);
        let page = adapter
            .fetch_rows("main", "player", None, 5, 10, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(page.rows.len(), 5);
        assert_eq!(page.rows[0]["id"], json!(20));
        assert_eq!(page.rows[0]["owner"], json!("0x01"));
        assert_eq!(page.rows[0]["nick"], json!("n10"));
        let sorted = adapter
            .fetch_rows(
                "main",
                "player",
                None,
                3,
                0,
                Some("id"),
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(sorted.rows[0]["id"], json!(1));
        assert_eq!(
            adapter
                .count_rows("main", "player", None, false)
                .await
                .unwrap(),
            30
        );
        assert!(adapter
            .fetch_rows("main", "player", None, 100, 9_950, None, false, false, false)
            .await
            .is_err());
        assert!(adapter.execute_query("DELETE FROM player").await.is_err());
        let requests = server.requests();
        let sql: Vec<&str> = requests
            .iter()
            .filter(|request| request.route().ends_with("/sql"))
            .map(|request| request.body.as_str())
            .collect();
        assert_eq!(sql[0], "SELECT * FROM player LIMIT 15");
        assert_eq!(
            sql[1],
            format!("SELECT * FROM player LIMIT {}", MAX_ROWS + 1)
        );
        assert!(requests
            .iter()
            .all(|request| request.header("authorization") == Some("Bearer geheim")));
        assert_eq!(sql.len(), 3);
    }

    #[tokio::test]
    async fn oversized_sql_answers_are_aborted_with_a_limit_hint() {
        let server = http_mock::start(|_| (200, vec![b' '; SQL_LIMIT + 10]));
        let target = parse_connection(&local(&server.base, "game"), None).unwrap();
        let error = run_sql(&target, "SELECT * FROM player").await.unwrap_err();
        assert!(error.contains("LIMIT"), "{error}");
    }
}
