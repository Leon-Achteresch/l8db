use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use base64::Engine;
use serde_json::{json, Map, Value};

use super::aws::{self, quote_ident, quote_string, AwsConnection, Service};
use super::{
    attach_row_keys, timed, where_clause, ColumnInfo, DatabaseAdapter, DetailedColumnInfo,
    IndexInfo, QueryResult, RowCount, TableData, TableInfo,
};

static SERVICE: Service = Service {
    label: "DynamoDB",
    signing_name: "dynamodb",
    host_prefix: "dynamodb",
    target_prefix: "DynamoDB_20120810",
    content_type: "application/x-amz-json-1.0",
};

const MAX_TRANSACTION_STATEMENTS: usize = 100;
const SAMPLE_SIZE: i64 = 100;

type Item = Map<String, Value>;

pub struct DynamoAdapter {
    conn: AwsConnection,
    key: String,
}

pub struct TableMeta {
    keys: Vec<(String, String)>,
    attribute_types: HashMap<String, String>,
    index_keys: Vec<(String, String)>,
    item_count: i64,
    indexes: Vec<IndexInfo>,
}

impl TableMeta {
    fn key_names(&self) -> Vec<String> {
        self.keys.iter().map(|(name, _)| name.clone()).collect()
    }
}

type DescribeCache = Mutex<HashMap<String, (Instant, Arc<TableMeta>)>>;

fn describe_cache() -> &'static DescribeCache {
    static CACHE: OnceLock<DescribeCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cursor_cache() -> &'static Mutex<HashMap<String, BTreeMap<i64, Value>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, BTreeMap<i64, Value>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const TYPES: [(&str, &str); 10] = [
    ("S", "String"),
    ("N", "Number"),
    ("B", "Binary"),
    ("BOOL", "Boolean"),
    ("NULL", "Null"),
    ("M", "Map"),
    ("L", "List"),
    ("SS", "StringSet"),
    ("NS", "NumberSet"),
    ("BS", "BinarySet"),
];

fn type_name(code: &str) -> &'static str {
    TYPES
        .iter()
        .find(|(c, _)| *c == code)
        .map(|(_, name)| *name)
        .unwrap_or("Unknown")
}

fn attr_code(attr: &Value) -> Option<&str> {
    attr.as_object()?.keys().next().map(String::as_str)
}

fn number_json(text: &str) -> Value {
    if let Ok(i) = text.parse::<i64>() {
        return Value::from(i);
    }
    match text.parse::<f64>() {
        Ok(f) if f.is_finite() && f.to_string() == text => Value::from(f),
        _ => Value::String(text.to_string()),
    }
}

fn binary_json(value: &Value) -> Value {
    let bytes = value
        .as_str()
        .and_then(|b| base64::engine::general_purpose::STANDARD.decode(b).ok())
        .unwrap_or_default();
    Value::String(super::hex_blob(&bytes))
}

pub fn attr_to_json(attr: &Value) -> Value {
    let Some((code, value)) = attr.as_object().and_then(|o| o.iter().next()) else {
        return Value::Null;
    };
    match code.as_str() {
        "N" => number_json(value.as_str().unwrap_or_default()),
        "B" => binary_json(value),
        "NULL" => Value::Null,
        "M" => Value::Object(
            value
                .as_object()
                .map(|m| {
                    m.iter()
                        .map(|(k, v)| (k.clone(), attr_to_json(v)))
                        .collect()
                })
                .unwrap_or_default(),
        ),
        "L" => Value::Array(
            value
                .as_array()
                .map(|l| l.iter().map(attr_to_json).collect())
                .unwrap_or_default(),
        ),
        "NS" => Value::Array(
            value
                .as_array()
                .map(|l| {
                    l.iter()
                        .map(|n| number_json(n.as_str().unwrap_or_default()))
                        .collect()
                })
                .unwrap_or_default(),
        ),
        "BS" => Value::Array(
            value
                .as_array()
                .map(|l| l.iter().map(binary_json).collect())
                .unwrap_or_default(),
        ),
        _ => value.clone(),
    }
}

pub fn json_to_attr(value: &Value) -> Value {
    match value {
        Value::Null => json!({"NULL": true}),
        Value::Bool(b) => json!({ "BOOL": b }),
        Value::Number(n) => json!({"N": n.to_string()}),
        Value::String(s) => json!({ "S": s }),
        Value::Array(items) => json!({"L": items.iter().map(json_to_attr).collect::<Vec<_>>()}),
        Value::Object(map) => json!({"M": map
            .iter()
            .map(|(k, v)| (k.clone(), json_to_attr(v)))
            .collect::<Map<_, _>>()}),
    }
}

fn number_literal(text: &str) -> Result<String, String> {
    let trimmed = text.trim();
    let valid = !trimmed.is_empty()
        && trimmed
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '.' | 'e' | 'E'))
        && trimmed.parse::<f64>().is_ok_and(f64::is_finite);
    if valid {
        Ok(trimmed.to_string())
    } else {
        Err(format!("\"{text}\" ist keine gültige Zahl."))
    }
}

fn binary_literal(text: &str) -> Result<String, String> {
    let hex = super::hex_blob_body(text.trim())
        .ok_or_else(|| "Binärwerte als Hex mit \\x-Präfix angeben, z. B. \\x00ff.".to_string())?;
    let bytes: Vec<u8> = (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap_or(0))
        .collect();
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

fn json_array(text: &str, type_label: &str) -> Result<Vec<Value>, String> {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Array(items)) if !items.is_empty() => Ok(items),
        _ => Err(format!(
            "{type_label} erwartet ein nicht leeres JSON-Array, z. B. [\"a\", \"b\"]."
        )),
    }
}

fn infer_attr(text: &str) -> Value {
    let trimmed = text.trim();
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
            return json_to_attr(&value);
        }
    }
    json!({ "S": text })
}

pub fn text_to_attr(text: &str, type_label: Option<&str>) -> Result<Value, String> {
    Ok(match type_label.unwrap_or_default() {
        "String" => json!({ "S": text }),
        "Number" => json!({"N": number_literal(text)?}),
        "Boolean" => match text.trim().to_ascii_lowercase().as_str() {
            "true" | "1" => json!({"BOOL": true}),
            "false" | "0" => json!({"BOOL": false}),
            _ => return Err(format!("\"{text}\" ist kein Wahrheitswert (true/false).")),
        },
        "Binary" => json!({"B": binary_literal(text)?}),
        "Map" | "List" => {
            let value: Value = serde_json::from_str(text)
                .map_err(|e| format!("Ungültiges JSON für {}: {e}", type_label.unwrap_or("")))?;
            match (type_label, &value) {
                (Some("Map"), Value::Object(_)) | (Some("List"), Value::Array(_)) => {
                    json_to_attr(&value)
                }
                _ => infer_attr(text),
            }
        }
        "StringSet" => {
            let items = json_array(text, "StringSet")?;
            let strings: Option<Vec<&str>> = items.iter().map(Value::as_str).collect();
            json!({"SS": strings.ok_or("StringSet erwartet nur Zeichenketten.")?})
        }
        "NumberSet" => {
            let numbers = json_array(text, "NumberSet")?
                .iter()
                .map(|v| match v {
                    Value::Number(n) => Ok(n.to_string()),
                    Value::String(s) => number_literal(s),
                    other => Err(format!("{other} ist keine Zahl.")),
                })
                .collect::<Result<Vec<_>, _>>()?;
            json!({ "NS": numbers })
        }
        "BinarySet" => {
            let values = json_array(text, "BinarySet")?
                .iter()
                .map(|v| binary_literal(v.as_str().unwrap_or_default()))
                .collect::<Result<Vec<_>, _>>()?;
            json!({ "BS": values })
        }
        "Null" if text.trim().eq_ignore_ascii_case("null") => json!({"NULL": true}),
        _ => infer_attr(text),
    })
}

fn items_of(response: &Value) -> Vec<Item> {
    response
        .get("Items")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|i| i.as_object().cloned())
                .collect()
        })
        .unwrap_or_default()
}

fn item_row(item: &Item) -> Item {
    item.iter()
        .map(|(k, v)| (k.clone(), attr_to_json(v)))
        .collect()
}

fn ordered_columns(keys: &[String], items: &[Item]) -> Vec<String> {
    let mut columns = keys.to_vec();
    let rest: BTreeSet<&String> = items
        .iter()
        .flat_map(|item| item.keys())
        .filter(|k| !keys.contains(k))
        .collect();
    columns.extend(rest.into_iter().cloned());
    columns
}

fn rows_for(columns: &[String], items: &[Item]) -> Vec<Value> {
    items
        .iter()
        .map(|item| {
            let mut row = Map::with_capacity(columns.len());
            for column in columns {
                row.insert(
                    column.clone(),
                    item.get(column).map(attr_to_json).unwrap_or(Value::Null),
                );
            }
            Value::Object(row)
        })
        .collect()
}

fn is_select(sql: &str) -> bool {
    sql.trim_start_matches(|c: char| c.is_whitespace() || c == '(')
        .get(..6)
        .is_some_and(|w| w.eq_ignore_ascii_case("select"))
}

fn key_schema(value: Option<&Value>) -> Vec<(String, String)> {
    value
        .and_then(Value::as_array)
        .map(|keys| {
            keys.iter()
                .filter_map(|k| {
                    Some((
                        k.get("AttributeName")?.as_str()?.to_string(),
                        k.get("KeyType")?.as_str()?.to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn index_definition(keys: &[(String, String)], index: &Value) -> String {
    let parts: Vec<String> = keys.iter().map(|(n, t)| format!("{t} {n}")).collect();
    let projection = index
        .get("Projection")
        .and_then(|p| p.get("ProjectionType"))
        .and_then(Value::as_str)
        .unwrap_or("ALL");
    format!("{} · Projection {projection}", parts.join(", "))
}

pub fn parse_table_meta(table: &Value) -> TableMeta {
    let attribute_types: HashMap<String, String> = table
        .get("AttributeDefinitions")
        .and_then(Value::as_array)
        .map(|defs| {
            defs.iter()
                .filter_map(|d| {
                    Some((
                        d.get("AttributeName")?.as_str()?.to_string(),
                        type_name(d.get("AttributeType")?.as_str()?).to_string(),
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let primary = key_schema(table.get("KeySchema"));
    let mut indexes = vec![IndexInfo {
        name: "PRIMARY".to_string(),
        is_unique: true,
        is_primary: true,
        columns: primary.iter().map(|(n, _)| n.clone()).collect(),
        index_type: "Primärschlüssel".to_string(),
        definition: index_definition(&primary, &Value::Null),
    }];
    let mut index_keys: Vec<(String, String)> = Vec::new();
    for (field, label) in [
        ("GlobalSecondaryIndexes", "GSI"),
        ("LocalSecondaryIndexes", "LSI"),
    ] {
        for index in table
            .get(field)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let keys = key_schema(index.get("KeySchema"));
            let name = index
                .get("IndexName")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();
            for (attr, _) in &keys {
                if !primary.iter().any(|(p, _)| p == attr)
                    && !index_keys.iter().any(|(k, _)| k == attr)
                {
                    index_keys.push((attr.clone(), name.clone()));
                }
            }
            indexes.push(IndexInfo {
                name,
                is_unique: false,
                is_primary: false,
                columns: keys.iter().map(|(n, _)| n.clone()).collect(),
                index_type: label.to_string(),
                definition: index_definition(&keys, index),
            });
        }
    }
    TableMeta {
        keys: primary,
        attribute_types,
        index_keys,
        item_count: table.get("ItemCount").and_then(Value::as_i64).unwrap_or(0),
        indexes,
    }
}

impl DynamoAdapter {
    pub fn new(connection_string: &str, key: String) -> Result<Self, String> {
        Ok(Self {
            conn: aws::parse_url(connection_string, "dynamodb")?,
            key,
        })
    }

    async fn call(&self, action: &str, body: Value) -> Result<Value, String> {
        self.conn.client(&SERVICE).await?.call(action, &body).await
    }

    async fn meta(&self, table: &str) -> Result<Arc<TableMeta>, String> {
        let cache_key = format!("{}\u{0}{table}", self.key);
        if let Some((at, meta)) = describe_cache()
            .lock()
            .ok()
            .and_then(|c| c.get(&cache_key).cloned())
        {
            if at.elapsed() < Duration::from_secs(30) {
                return Ok(meta);
            }
        }
        let response = timed(self.call("DescribeTable", json!({ "TableName": table }))).await?;
        let meta = Arc::new(parse_table_meta(
            response.get("Table").unwrap_or(&Value::Null),
        ));
        if let Ok(mut cache) = describe_cache().lock() {
            if cache.len() > 500 {
                cache.clear();
            }
            cache.insert(cache_key, (Instant::now(), meta.clone()));
        }
        Ok(meta)
    }

    async fn get_item(&self, table: &str, key: &Item) -> Result<Option<Item>, String> {
        let response = timed(self.call(
            "GetItem",
            json!({"TableName": table, "Key": key, "ConsistentRead": true}),
        ))
        .await?;
        Ok(response.get("Item").and_then(Value::as_object).cloned())
    }

    async fn column_types(&self, table: &str) -> Result<HashMap<String, String>, String> {
        Ok(self
            .detailed(table)
            .await?
            .into_iter()
            .filter(|c| c.data_type != "Mixed")
            .map(|c| (c.name, c.data_type))
            .collect())
    }

    async fn page(
        &self,
        table: &str,
        where_sql: &str,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<Item>, String> {
        let cache_key = format!("{}\u{0}{table}\u{0}{where_sql}", self.key);
        let offset = offset.max(0);
        let target = offset + limit.max(0);
        let cached = cursor_cache().lock().ok().and_then(|c| {
            c.get(&cache_key)?
                .range(..=offset)
                .next_back()
                .map(|(pos, cursor)| (*pos, cursor.clone()))
        });
        if let Some((pos, cursor)) = cached {
            match self
                .page_from(
                    &cache_key,
                    table,
                    where_sql,
                    offset,
                    target,
                    pos,
                    Some(cursor),
                )
                .await
            {
                Ok(items) => return Ok(items),
                Err(_) => {
                    if let Ok(mut c) = cursor_cache().lock() {
                        c.remove(&cache_key);
                    }
                }
            }
        }
        self.page_from(&cache_key, table, where_sql, offset, target, 0, None)
            .await
    }

    #[allow(clippy::too_many_arguments)]
    async fn page_from(
        &self,
        cache_key: &str,
        table: &str,
        where_sql: &str,
        offset: i64,
        target: i64,
        mut pos: i64,
        mut cursor: Option<Value>,
    ) -> Result<Vec<Item>, String> {
        let client = self.conn.client(&SERVICE).await?;
        let statement = (!where_sql.is_empty())
            .then(|| format!("SELECT * FROM {}{where_sql}", quote_ident(table)));
        let mut items = Vec::new();
        while pos < target {
            let need = (target - pos).min(1000);
            let (action, cursor_field, next_field, mut body) = match &statement {
                None => (
                    "Scan",
                    "ExclusiveStartKey",
                    "LastEvaluatedKey",
                    json!({"TableName": table, "Limit": need}),
                ),
                Some(s) => (
                    "ExecuteStatement",
                    "NextToken",
                    "NextToken",
                    json!({"Statement": s, "Limit": need}),
                ),
            };
            if let Some(c) = &cursor {
                body[cursor_field] = c.clone();
            }
            let response = client.call(action, &body).await?;
            for item in items_of(&response) {
                if pos >= offset && pos < target {
                    items.push(item);
                }
                pos += 1;
            }
            cursor = response.get(next_field).filter(|v| !v.is_null()).cloned();
            if cursor.is_none() {
                break;
            }
        }
        if let (true, Some(c)) = (pos == target, cursor) {
            if let Ok(mut cache) = cursor_cache().lock() {
                if cache.len() > 200 {
                    cache.clear();
                }
                cache
                    .entry(cache_key.to_string())
                    .or_default()
                    .insert(target, c);
            }
        }
        Ok(items)
    }

    async fn count(&self, table: &str, where_sql: &str, cap: Option<i64>) -> Result<i64, String> {
        let client = self.conn.client(&SERVICE).await?;
        let statement = if where_sql.is_empty() {
            None
        } else {
            let keys = self.meta(table).await?.key_names();
            Some(format!(
                "SELECT {} FROM {}{where_sql}",
                keys.iter()
                    .map(|k| quote_ident(k))
                    .collect::<Vec<_>>()
                    .join(", "),
                quote_ident(table)
            ))
        };
        let mut total = 0i64;
        let mut cursor: Option<Value> = None;
        loop {
            match &statement {
                None => {
                    let mut body = json!({"TableName": table, "Select": "COUNT"});
                    if let Some(c) = &cursor {
                        body["ExclusiveStartKey"] = c.clone();
                    }
                    let response = client.call("Scan", &body).await?;
                    total += response.get("Count").and_then(Value::as_i64).unwrap_or(0);
                    cursor = response.get("LastEvaluatedKey").cloned();
                }
                Some(s) => {
                    let mut body = json!({ "Statement": s });
                    if let Some(c) = &cursor {
                        body["NextToken"] = c.clone();
                    }
                    let response = client.call("ExecuteStatement", &body).await?;
                    total += items_of(&response).len() as i64;
                    cursor = response.get("NextToken").cloned();
                }
            }
            cursor = cursor.filter(|c| !c.is_null());
            if cursor.is_none() || cap.is_some_and(|cap| total > cap) {
                break;
            }
            if super::execution::cancellation_token().is_cancelled() {
                return Err("Zählung abgebrochen.".to_string());
            }
        }
        Ok(total)
    }

    async fn detailed(&self, table: &str) -> Result<Vec<DetailedColumnInfo>, String> {
        let meta = self.meta(table).await?;
        let sample = items_of(
            &timed(self.call("Scan", json!({"TableName": table, "Limit": SAMPLE_SIZE}))).await?,
        );
        let mut seen: BTreeMap<String, (BTreeSet<String>, usize)> = BTreeMap::new();
        for item in &sample {
            for (name, attr) in item {
                let entry = seen.entry(name.clone()).or_default();
                if let Some(code) = attr_code(attr) {
                    entry.0.insert(type_name(code).to_string());
                }
                entry.1 += 1;
            }
        }
        let mut columns = Vec::new();
        let mut push = |name: &str, data_type: String, nullable: bool, pk: bool, comment| {
            columns.push(DetailedColumnInfo {
                name: name.to_string(),
                data_type,
                is_nullable: nullable,
                column_default: None,
                is_primary_key: pk,
                ordinal_position: columns.len() as i32 + 1,
                character_maximum_length: None,
                comment,
            });
        };
        let inferred = |name: &str| -> (String, bool) {
            match seen.get(name) {
                Some((types, present)) => (
                    if types.len() == 1 {
                        types.iter().next().cloned().unwrap_or_default()
                    } else {
                        "Mixed".to_string()
                    },
                    *present < sample.len() || types.contains("Null"),
                ),
                None => ("String".to_string(), true),
            }
        };
        for (name, key_type) in &meta.keys {
            let data_type = meta
                .attribute_types
                .get(name)
                .cloned()
                .unwrap_or_else(|| inferred(name).0);
            let comment = if key_type == "HASH" {
                "Partitionsschlüssel (HASH)"
            } else {
                "Sortierschlüssel (RANGE)"
            };
            push(name, data_type, false, true, Some(comment.to_string()));
        }
        for (name, index) in &meta.index_keys {
            let data_type = meta
                .attribute_types
                .get(name)
                .cloned()
                .unwrap_or_else(|| inferred(name).0);
            push(
                name,
                data_type,
                true,
                false,
                Some(format!("Indexschlüssel ({index})")),
            );
        }
        for name in seen.keys() {
            if meta.keys.iter().any(|(k, _)| k == name)
                || meta.index_keys.iter().any(|(k, _)| k == name)
            {
                continue;
            }
            let (data_type, nullable) = inferred(name);
            push(name, data_type, nullable, false, None);
        }
        Ok(columns)
    }

    fn key_from_ctid(&self, meta: &TableMeta, ctid: &str) -> Result<Item, String> {
        let parsed: Item = serde_json::from_str(ctid).map_err(|_| {
            "Zeile hat keinen Primärschlüssel und kann nicht bearbeitet werden".to_string()
        })?;
        let mut key = Item::new();
        for (name, _) in &meta.keys {
            let text = match parsed.get(name) {
                Some(Value::String(s)) => s.clone(),
                Some(other) if !other.is_null() => other.to_string(),
                _ => return Err(format!("Schlüsselattribut \"{name}\" fehlt.")),
            };
            let label = meta.attribute_types.get(name).map(String::as_str);
            key.insert(name.clone(), text_to_attr(&text, label)?);
        }
        Ok(key)
    }
}

#[async_trait]
impl DatabaseAdapter for DynamoAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        timed(self.call("ListTables", json!({"Limit": 1})))
            .await
            .map(|_| ())
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(vec![self.conn.region()?])
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(vec![self.conn.region()?])
    }

    async fn list_tables(&self, _schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let region = self.conn.region()?;
        let client = self.conn.client(&SERVICE).await?;
        timed(async {
            let mut names = Vec::new();
            let mut start: Option<Value> = None;
            loop {
                let mut body = json!({"Limit": 100});
                if let Some(s) = &start {
                    body["ExclusiveStartTableName"] = s.clone();
                }
                let response = client.call("ListTables", &body).await?;
                names.extend(
                    response
                        .get("TableNames")
                        .and_then(Value::as_array)
                        .into_iter()
                        .flatten()
                        .filter_map(Value::as_str)
                        .map(str::to_string),
                );
                start = response
                    .get("LastEvaluatedTableName")
                    .filter(|v| !v.is_null())
                    .cloned();
                if start.is_none() || names.len() >= 10_000 {
                    break;
                }
            }
            Ok(names
                .into_iter()
                .map(|name| TableInfo {
                    schema: region.clone(),
                    name,
                })
                .collect())
        })
        .await
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        _table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let region = schema
            .map(str::to_string)
            .map_or_else(|| self.conn.region(), Ok)?;
        if let Some(table) = table {
            return Ok(self
                .detailed(table)
                .await?
                .into_iter()
                .map(|c| ColumnInfo {
                    schema: region.clone(),
                    table: table.to_string(),
                    name: c.name,
                    data_type: c.data_type,
                })
                .collect());
        }
        let tables: Vec<TableInfo> = self
            .list_tables(schema)
            .await?
            .into_iter()
            .take(100)
            .collect();
        let metas = futures_util::future::join_all(tables.iter().map(|t| self.meta(&t.name))).await;
        Ok(tables
            .iter()
            .zip(metas)
            .filter_map(|(t, meta)| Some((t, meta.ok()?)))
            .flat_map(|(t, meta)| {
                meta.keys
                    .iter()
                    .map(|(name, _)| ColumnInfo {
                        schema: region.clone(),
                        table: t.name.clone(),
                        name: name.clone(),
                        data_type: meta.attribute_types.get(name).cloned().unwrap_or_default(),
                    })
                    .collect::<Vec<_>>()
            })
            .collect())
    }

    async fn list_table_columns_detailed(
        &self,
        _schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        self.detailed(table).await
    }

    async fn list_indexes(&self, _schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        Ok(self.meta(table).await?.indexes.clone())
    }

    async fn fetch_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        _order_by: Option<&str>,
        _order_desc: bool,
        is_view: bool,
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let meta = self.meta(table).await?;
        let items = timed(self.page(table, &where_sql, offset, limit)).await?;
        let keys = meta.key_names();
        let columns = ordered_columns(&keys, &items);
        let mut rows = rows_for(&columns, &items);
        if !is_view {
            attach_row_keys(&mut rows, &keys);
        }
        Ok(TableData { columns, rows })
    }

    async fn count_rows(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        timed(self.count(table, &where_sql, None)).await
    }

    async fn count_rows_capped(
        &self,
        _schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
        cap: i64,
    ) -> Result<RowCount, String> {
        let where_sql = where_clause(filter, allow_raw_filter)?;
        let count = timed(self.count(table, &where_sql, Some(cap))).await?;
        if count <= cap {
            return Ok(RowCount::exact(count));
        }
        let estimate = if where_sql.is_empty() {
            self.meta(table)
                .await
                .ok()
                .map(|m| m.item_count)
                .filter(|c| *c > cap)
        } else {
            None
        };
        Ok(RowCount {
            count: count.min(cap.saturating_add(1)),
            exact: false,
            estimate,
        })
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let start = Instant::now();
        let statement = sql.trim().trim_end_matches(';').trim().to_string();
        let client = self.conn.client(&SERVICE).await?;
        let items = timed(async {
            let mut items = Vec::new();
            let mut token: Option<Value> = None;
            loop {
                let mut body = json!({ "Statement": statement });
                if let Some(t) = &token {
                    body["NextToken"] = t.clone();
                }
                let response = client.call("ExecuteStatement", &body).await?;
                items.extend(items_of(&response));
                token = response.get("NextToken").filter(|v| !v.is_null()).cloned();
                if token.is_none() || items.len() >= super::commands::MAX_RESULT_ROWS {
                    break;
                }
            }
            Ok(items)
        })
        .await?;
        if !is_select(&statement) {
            return Ok(QueryResult {
                columns: Vec::new(),
                rows: Vec::new(),
                rows_affected: Some(1),
                execution_time_ms: start.elapsed().as_millis() as u64,
            });
        }
        let mut columns: Vec<String> = Vec::new();
        for item in &items {
            for name in item.keys() {
                if !columns.contains(name) {
                    columns.push(name.clone());
                }
            }
        }
        Ok(QueryResult {
            rows: rows_for(&columns, &items),
            columns,
            rows_affected: None,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }
}

enum Op {
    Insert(Item),
    Update {
        key: Item,
        set: Item,
        remove: Vec<String>,
    },
    Delete(Item),
    Statement(String),
}

struct Staged {
    table: String,
    id: Option<String>,
    op: Op,
}

pub struct DynamoTx {
    adapter: DynamoAdapter,
    staged: tokio::sync::Mutex<Vec<Staged>>,
}

fn item_id(table: &str, key: &Item) -> String {
    format!("{table}\u{0}{}", Value::Object(key.clone()))
}

fn key_condition(key: &Item, params: &mut Vec<Value>) -> String {
    key.iter()
        .map(|(name, value)| {
            params.push(value.clone());
            format!("{} = ?", quote_ident(name))
        })
        .collect::<Vec<_>>()
        .join(" AND ")
}

fn render(staged: &Staged) -> Option<Value> {
    let table = quote_ident(&staged.table);
    let mut params: Vec<Value> = Vec::new();
    let statement = match &staged.op {
        Op::Statement(sql) => sql.clone(),
        Op::Insert(item) => {
            let fields: Vec<String> = item
                .iter()
                .map(|(name, value)| {
                    params.push(value.clone());
                    format!("{}: ?", quote_string(name))
                })
                .collect();
            format!("INSERT INTO {table} VALUE {{{}}}", fields.join(", "))
        }
        Op::Update { key, set, remove } => {
            if set.is_empty() && remove.is_empty() {
                return None;
            }
            let mut clauses: Vec<String> = set
                .iter()
                .map(|(name, value)| {
                    params.push(value.clone());
                    format!("SET {} = ?", quote_ident(name))
                })
                .collect();
            clauses.extend(
                remove
                    .iter()
                    .map(|name| format!("REMOVE {}", quote_ident(name))),
            );
            let condition = key_condition(key, &mut params);
            format!("UPDATE {table} {} WHERE {condition}", clauses.join(" "))
        }
        Op::Delete(key) => {
            let condition = key_condition(key, &mut params);
            format!("DELETE FROM {table} WHERE {condition}")
        }
    };
    let mut entry = json!({ "Statement": statement });
    if !params.is_empty() {
        entry["Parameters"] = Value::Array(params);
    }
    Some(entry)
}

impl DynamoTx {
    pub fn new(connection_string: &str, key: String) -> Result<Self, String> {
        Ok(Self {
            adapter: DynamoAdapter::new(connection_string, key)?,
            staged: tokio::sync::Mutex::new(Vec::new()),
        })
    }

    pub fn adapter(&self) -> &DynamoAdapter {
        &self.adapter
    }

    pub async fn execute(&self, sql: &str) -> Result<QueryResult, String> {
        if is_select(sql) {
            return self.adapter.execute_query(sql).await;
        }
        let statement = sql.trim().trim_end_matches(';').trim().to_string();
        if statement.is_empty() {
            return Err("Leere Anweisung".to_string());
        }
        self.staged.lock().await.push(Staged {
            table: String::new(),
            id: None,
            op: Op::Statement(statement),
        });
        Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: Some(1),
            execution_time_ms: 0,
        })
    }

    pub async fn update_row(
        &self,
        table: &str,
        ctid: &str,
        updates: &HashMap<String, Option<String>>,
    ) -> Result<String, String> {
        if updates.is_empty() {
            return Ok(ctid.to_string());
        }
        let meta = self.adapter.meta(table).await?;
        if let Some(col) = updates
            .keys()
            .find(|c| meta.keys.iter().any(|(k, _)| k == *c))
        {
            return Err(format!(
                "Schlüsselattribut \"{col}\" kann in DynamoDB nicht geändert werden. Zeile löschen und neu einfügen."
            ));
        }
        let key = self.adapter.key_from_ctid(&meta, ctid)?;
        let id = item_id(table, &key);
        let mut staged = self.staged.lock().await;
        let pos = staged.iter().position(|s| s.id.as_deref() == Some(&id));
        let (current, pending) = match pos.map(|i| &staged[i].op) {
            Some(Op::Delete(_)) => {
                return Err("Die Zeile wurde in dieser Transaktion bereits gelöscht.".to_string())
            }
            Some(Op::Insert(item)) => (item.clone(), Item::new()),
            Some(Op::Update { set, .. }) => (
                self.adapter
                    .get_item(table, &key)
                    .await?
                    .unwrap_or_default(),
                set.clone(),
            ),
            _ => (
                self.adapter
                    .get_item(table, &key)
                    .await?
                    .ok_or_else(|| "Zeile nicht gefunden".to_string())?,
                Item::new(),
            ),
        };
        let mut column_types: Option<HashMap<String, String>> = None;
        let mut set = Item::new();
        let mut remove = Vec::new();
        for (col, value) in updates {
            let Some(text) = value else {
                remove.push(col.clone());
                continue;
            };
            let known = pending
                .get(col)
                .or_else(|| current.get(col))
                .and_then(attr_code)
                .map(|code| type_name(code).to_string());
            let label = match known {
                Some(label) => Some(label),
                None => {
                    if column_types.is_none() {
                        column_types = Some(self.adapter.column_types(table).await?);
                    }
                    column_types.as_ref().and_then(|t| t.get(col).cloned())
                }
            };
            set.insert(col.clone(), text_to_attr(text, label.as_deref())?);
        }
        match pos.map(|i| &mut staged[i].op) {
            Some(Op::Insert(item)) => {
                for name in &remove {
                    item.remove(name);
                }
                item.extend(set);
            }
            Some(Op::Update {
                set: staged_set,
                remove: staged_remove,
                ..
            }) => {
                for name in remove {
                    staged_set.remove(&name);
                    if !staged_remove.contains(&name) {
                        staged_remove.push(name);
                    }
                }
                for (name, value) in set {
                    staged_remove.retain(|r| r != &name);
                    staged_set.insert(name, value);
                }
            }
            _ => staged.push(Staged {
                table: table.to_string(),
                id: Some(id),
                op: Op::Update { key, set, remove },
            }),
        }
        Ok(ctid.to_string())
    }

    pub async fn insert_row(
        &self,
        table: &str,
        values: &HashMap<String, Option<String>>,
    ) -> Result<Value, String> {
        let meta = self.adapter.meta(table).await?;
        let types = self.adapter.column_types(table).await?;
        let mut item = Item::new();
        for (name, _) in &meta.keys {
            if let Some(Some(text)) = values.get(name) {
                item.insert(
                    name.clone(),
                    text_to_attr(text, types.get(name).map(String::as_str))?,
                );
            }
        }
        let mut rest: Vec<(&String, &String)> = values
            .iter()
            .filter_map(|(k, v)| Some((k, v.as_ref()?)))
            .filter(|(k, _)| !item.contains_key(*k))
            .collect();
        rest.sort();
        for (name, text) in rest {
            item.insert(
                name.clone(),
                text_to_attr(text, types.get(name).map(String::as_str))?,
            );
        }
        let mut key = Item::new();
        for (name, _) in &meta.keys {
            let value = item
                .get(name)
                .cloned()
                .ok_or_else(|| format!("Schlüsselattribut \"{name}\" fehlt."))?;
            key.insert(name.clone(), value);
        }
        let id = item_id(table, &key);
        let mut staged = self.staged.lock().await;
        if staged.iter().any(|s| s.id.as_deref() == Some(&id)) {
            return Err(
                "Für diesen Schlüssel gibt es in dieser Transaktion bereits eine Änderung."
                    .to_string(),
            );
        }
        staged.push(Staged {
            table: table.to_string(),
            id: Some(id),
            op: Op::Insert(item.clone()),
        });
        let mut row = Value::Object(item_row(&item));
        attach_row_keys(std::slice::from_mut(&mut row), &meta.key_names());
        Ok(row)
    }

    pub async fn delete_row(&self, table: &str, ctid: &str) -> Result<(), String> {
        let meta = self.adapter.meta(table).await?;
        let key = self.adapter.key_from_ctid(&meta, ctid)?;
        let id = item_id(table, &key);
        let mut staged = self.staged.lock().await;
        match staged.iter().position(|s| s.id.as_deref() == Some(&id)) {
            Some(i) => match staged[i].op {
                Op::Insert(_) => {
                    staged.remove(i);
                }
                Op::Delete(_) => {
                    return Err("Die Zeile wurde bereits gelöscht.".to_string());
                }
                _ => staged[i].op = Op::Delete(key),
            },
            None => staged.push(Staged {
                table: table.to_string(),
                id: Some(id),
                op: Op::Delete(key),
            }),
        }
        Ok(())
    }

    pub async fn commit(&self) -> Result<(), String> {
        let mut staged = self.staged.lock().await;
        let statements: Vec<Value> = staged.iter().filter_map(render).collect();
        if statements.len() > MAX_TRANSACTION_STATEMENTS {
            return Err(format!(
                "DynamoDB erlaubt höchstens {MAX_TRANSACTION_STATEMENTS} Änderungen pro Transaktion ({} vorgemerkt).",
                statements.len()
            ));
        }
        if !statements.is_empty() {
            timed(self.adapter.call(
                "ExecuteTransaction",
                json!({ "TransactStatements": statements }),
            ))
            .await?;
        }
        staged.clear();
        Ok(())
    }

    pub async fn rollback(&self) -> Result<(), String> {
        self.staged.lock().await.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmarshals_all_attribute_types() {
        let item = json!({
            "s": {"S": "x"}, "n": {"N": "42"}, "f": {"N": "1.5"}, "big": {"N": "123456789012345678901234567890"},
            "b": {"B": "AP8="}, "t": {"BOOL": true}, "z": {"NULL": true},
            "m": {"M": {"a": {"N": "1"}, "l": {"L": [{"S": "y"}, {"BOOL": false}]}}},
            "ss": {"SS": ["a", "b"]}, "ns": {"NS": ["1", "2.5"]}, "bs": {"BS": ["AP8="]}
        });
        let row = item_row(item.as_object().unwrap());
        assert_eq!(row["s"], json!("x"));
        assert_eq!(row["n"], json!(42));
        assert_eq!(row["f"], json!(1.5));
        assert_eq!(row["big"], json!("123456789012345678901234567890"));
        assert_eq!(row["b"], json!("\\x00ff"));
        assert_eq!(row["t"], json!(true));
        assert_eq!(row["z"], Value::Null);
        assert_eq!(row["m"], json!({"a": 1, "l": ["y", false]}));
        assert_eq!(row["ss"], json!(["a", "b"]));
        assert_eq!(row["ns"], json!([1, 2.5]));
        assert_eq!(row["bs"], json!(["\\x00ff"]));
    }

    #[test]
    fn converts_text_back_by_type() {
        assert_eq!(
            text_to_attr("7", Some("Number")).unwrap(),
            json!({"N": "7"})
        );
        assert!(text_to_attr("7x", Some("Number")).is_err());
        assert_eq!(
            text_to_attr("7", Some("String")).unwrap(),
            json!({"S": "7"})
        );
        assert_eq!(
            text_to_attr("\\x00ff", Some("Binary")).unwrap(),
            json!({"B": "AP8="})
        );
        assert_eq!(
            text_to_attr("TRUE", Some("Boolean")).unwrap(),
            json!({"BOOL": true})
        );
        assert_eq!(
            text_to_attr("{\"a\": [1, null]}", Some("Map")).unwrap(),
            json!({"M": {"a": {"L": [{"N": "1"}, {"NULL": true}]}}})
        );
        assert_eq!(
            text_to_attr("[1, \"2\"]", Some("NumberSet")).unwrap(),
            json!({"NS": ["1", "2"]})
        );
        assert!(text_to_attr("[]", Some("StringSet")).is_err());
        assert_eq!(
            text_to_attr("[\"x\"]", None).unwrap(),
            json!({"L": [{"S": "x"}]})
        );
        assert_eq!(text_to_attr("hallo", None).unwrap(), json!({"S": "hallo"}));
    }

    #[test]
    fn parses_describe_table_with_indexes() {
        let meta = parse_table_meta(&json!({
            "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}, {"AttributeName": "sk", "KeyType": "RANGE"}],
            "AttributeDefinitions": [
                {"AttributeName": "pk", "AttributeType": "S"},
                {"AttributeName": "sk", "AttributeType": "N"},
                {"AttributeName": "email", "AttributeType": "S"}
            ],
            "ItemCount": 12,
            "GlobalSecondaryIndexes": [{"IndexName": "by_email", "KeySchema": [{"AttributeName": "email", "KeyType": "HASH"}], "Projection": {"ProjectionType": "KEYS_ONLY"}}]
        }));
        assert_eq!(meta.key_names(), vec!["pk", "sk"]);
        assert_eq!(meta.attribute_types["sk"], "Number");
        assert_eq!(meta.item_count, 12);
        assert_eq!(
            meta.index_keys,
            vec![("email".to_string(), "by_email".to_string())]
        );
        assert_eq!(meta.indexes.len(), 2);
        assert_eq!(meta.indexes[1].index_type, "GSI");
        assert_eq!(
            meta.indexes[1].definition,
            "HASH email · Projection KEYS_ONLY"
        );
    }

    #[test]
    fn renders_staged_changes_as_parameterized_partiql() {
        let key: Item = json!({"pk": {"S": "a'b"}}).as_object().unwrap().clone();
        let update = Staged {
            table: "Orders".to_string(),
            id: None,
            op: Op::Update {
                key: key.clone(),
                set: json!({"total": {"N": "5"}}).as_object().unwrap().clone(),
                remove: vec!["note".to_string()],
            },
        };
        assert_eq!(
            render(&update).unwrap(),
            json!({
                "Statement": "UPDATE \"Orders\" SET \"total\" = ? REMOVE \"note\" WHERE \"pk\" = ?",
                "Parameters": [{"N": "5"}, {"S": "a'b"}]
            })
        );
        let insert = Staged {
            table: "Orders".to_string(),
            id: None,
            op: Op::Insert(
                json!({"pk": {"S": "x"}, "it's": {"N": "1"}})
                    .as_object()
                    .unwrap()
                    .clone(),
            ),
        };
        assert_eq!(
            render(&insert).unwrap()["Statement"],
            json!("INSERT INTO \"Orders\" VALUE {'pk': ?, 'it''s': ?}")
        );
        let delete = Staged {
            table: "Orders".to_string(),
            id: None,
            op: Op::Delete(key),
        };
        assert_eq!(
            render(&delete).unwrap()["Statement"],
            json!("DELETE FROM \"Orders\" WHERE \"pk\" = ?")
        );
        let statement = Staged {
            table: String::new(),
            id: None,
            op: Op::Statement("DELETE FROM x WHERE id = 1".to_string()),
        };
        assert!(render(&statement).unwrap().get("Parameters").is_none());
    }

    #[test]
    fn detects_select_statements() {
        assert!(is_select("  select * from t"));
        assert!(is_select("(SELECT 1)"));
        assert!(!is_select("INSERT INTO t VALUE {'a': 1}"));
        assert!(!is_select("sel"));
    }

    #[test]
    fn orders_key_columns_first() {
        let items: Vec<Item> = vec![
            json!({"z": {"S": "1"}, "pk": {"S": "a"}})
                .as_object()
                .unwrap()
                .clone(),
            json!({"a": {"S": "1"}, "pk": {"S": "b"}})
                .as_object()
                .unwrap()
                .clone(),
        ];
        let columns = ordered_columns(&["pk".to_string()], &items);
        assert_eq!(columns, vec!["pk", "a", "z"]);
        let rows = rows_for(&columns, &items);
        assert_eq!(rows[0]["a"], Value::Null);
    }

    #[tokio::test]
    #[ignore]
    async fn dynamodb_local_end_to_end() {
        let url = std::env::var("L8DB_E2E_DYNAMODB_URL").unwrap_or_else(|_| {
            "dynamodb://local:local@us-east-1?endpoint=http%3A%2F%2F127.0.0.1%3A18000".to_string()
        });
        let adapter = DynamoAdapter::new(&url, "ddb-e2e".to_string()).unwrap();
        let table = "l8db_e2e_orders";
        let _ = adapter
            .call("DeleteTable", json!({ "TableName": table }))
            .await;
        adapter
            .call(
                "CreateTable",
                json!({
                    "TableName": table,
                    "BillingMode": "PAY_PER_REQUEST",
                    "AttributeDefinitions": [
                        {"AttributeName": "pk", "AttributeType": "S"},
                        {"AttributeName": "sk", "AttributeType": "N"},
                        {"AttributeName": "email", "AttributeType": "S"}
                    ],
                    "KeySchema": [
                        {"AttributeName": "pk", "KeyType": "HASH"},
                        {"AttributeName": "sk", "KeyType": "RANGE"}
                    ],
                    "GlobalSecondaryIndexes": [{
                        "IndexName": "by_email",
                        "KeySchema": [{"AttributeName": "email", "KeyType": "HASH"}],
                        "Projection": {"ProjectionType": "ALL"}
                    }]
                }),
            )
            .await
            .unwrap();
        for i in 0..25 {
            adapter
                .execute_query(&format!(
                    "INSERT INTO \"{table}\" VALUE {{'pk': 'c{}', 'sk': {i}, 'email': 'u{i}@x.de', 'total': {}, 'tags': ['a', 'b'], 'meta': {{'vip': {}}}}}",
                    i % 3,
                    i * 10,
                    i % 2 == 0
                ))
                .await
                .unwrap();
        }
        let tables = adapter.list_tables(None).await.unwrap();
        assert!(tables.iter().any(|t| t.name == table));
        let columns = adapter.detailed(table).await.unwrap();
        let names: Vec<&str> = columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(&names[..3], &["pk", "sk", "email"]);
        assert!(columns[0].is_primary_key && columns[1].is_primary_key);
        assert_eq!(columns[1].data_type, "Number");
        assert_eq!(
            columns.iter().find(|c| c.name == "meta").unwrap().data_type,
            "Map"
        );
        let indexes = adapter.list_indexes("", table).await.unwrap();
        assert_eq!(indexes.len(), 2);

        let mut seen = std::collections::HashSet::new();
        for page in 0..3 {
            let data = adapter
                .fetch_rows("", table, None, 10, page * 10, None, false, false, false)
                .await
                .unwrap();
            assert_eq!(data.columns[..2], ["pk".to_string(), "sk".to_string()]);
            for row in &data.rows {
                assert!(seen.insert(row["__ctid__"].as_str().unwrap().to_string()));
            }
        }
        assert_eq!(seen.len(), 25);
        let again = adapter
            .fetch_rows("", table, None, 5, 12, None, false, false, false)
            .await
            .unwrap();
        assert_eq!(again.rows.len(), 5);

        let filtered = adapter
            .fetch_rows(
                "",
                table,
                Some("\"pk\" = 'c1'"),
                100,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        assert_eq!(filtered.rows.len(), 8);
        assert_eq!(
            adapter
                .count_rows("", table, Some("\"total\" >= 100"), false)
                .await
                .unwrap(),
            15
        );
        assert_eq!(
            adapter.count_rows("", table, None, false).await.unwrap(),
            25
        );
        let capped = adapter
            .count_rows_capped("", table, None, false, 10)
            .await
            .unwrap();
        assert!(!capped.exact);
        assert_eq!(capped.count, 11);

        let query = adapter
            .execute_query(&format!(
                "SELECT * FROM \"{table}\" WHERE \"pk\" = 'c0' AND \"sk\" = 3"
            ))
            .await
            .unwrap();
        assert_eq!(query.rows.len(), 1);
        assert_eq!(query.rows[0]["meta"], json!({"vip": false}));
        assert_eq!(query.rows[0]["tags"], json!(["a", "b"]));

        let tx = DynamoTx::new(&url, "ddb-e2e".to_string()).unwrap();
        let ctid = json!({"pk": "c0", "sk": 3}).to_string();
        let mut updates = HashMap::new();
        updates.insert("total".to_string(), Some("999".to_string()));
        updates.insert("tags".to_string(), None);
        updates.insert("note".to_string(), Some("neu".to_string()));
        tx.update_row(table, &ctid, &updates).await.unwrap();
        let mut key_update = HashMap::new();
        key_update.insert("sk".to_string(), Some("4".to_string()));
        assert!(tx.update_row(table, &ctid, &key_update).await.is_err());
        let mut values = HashMap::new();
        values.insert("pk".to_string(), Some("c9".to_string()));
        values.insert("sk".to_string(), Some("100".to_string()));
        values.insert("total".to_string(), Some("5".to_string()));
        values.insert("meta".to_string(), Some("{\"vip\": true}".to_string()));
        let inserted = tx.insert_row(table, &values).await.unwrap();
        assert_eq!(inserted["total"], json!(5));
        tx.delete_row(table, &json!({"pk": "c1", "sk": 1}).to_string())
            .await
            .unwrap();
        let staged = tx
            .execute(&format!(
                "UPDATE \"{table}\" SET \"total\" = 1 WHERE \"pk\" = 'c2' AND \"sk\" = 2"
            ))
            .await
            .unwrap();
        assert_eq!(staged.rows_affected, Some(1));
        assert_eq!(
            adapter.count_rows("", table, None, false).await.unwrap(),
            25
        );
        tx.commit().await.unwrap();

        let item = adapter
            .get_item(
                table,
                &json!({"pk": {"S": "c0"}, "sk": {"N": "3"}})
                    .as_object()
                    .unwrap()
                    .clone(),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(item["total"], json!({"N": "999"}));
        assert_eq!(item["note"], json!({"S": "neu"}));
        assert!(!item.contains_key("tags"));
        let inserted = adapter
            .get_item(
                table,
                &json!({"pk": {"S": "c9"}, "sk": {"N": "100"}})
                    .as_object()
                    .unwrap()
                    .clone(),
            )
            .await
            .unwrap()
            .unwrap();
        assert_eq!(inserted["meta"], json!({"M": {"vip": {"BOOL": true}}}));
        assert_eq!(
            adapter.count_rows("", table, None, false).await.unwrap(),
            25
        );
        let updated = adapter
            .execute_query(&format!(
                "SELECT \"total\" FROM \"{table}\" WHERE \"pk\" = 'c2' AND \"sk\" = 2"
            ))
            .await
            .unwrap();
        assert_eq!(updated.rows[0]["total"], json!(1));

        let failing = DynamoTx::new(&url, "ddb-e2e".to_string()).unwrap();
        failing
            .delete_row(table, &json!({"pk": "c0", "sk": 3}).to_string())
            .await
            .unwrap();
        failing
            .execute(&format!(
                "INSERT INTO \"{table}\" VALUE {{'pk': 'c9', 'sk': 100}}"
            ))
            .await
            .unwrap();
        let error = failing.commit().await.unwrap_err();
        assert!(error.contains("TransactionCanceledException"), "{error}");
        assert!(adapter
            .get_item(
                table,
                &json!({"pk": {"S": "c0"}, "sk": {"N": "3"}})
                    .as_object()
                    .unwrap()
                    .clone()
            )
            .await
            .unwrap()
            .is_some());
        failing.rollback().await.unwrap();

        adapter
            .call("DeleteTable", json!({ "TableName": table }))
            .await
            .unwrap();
    }
}
