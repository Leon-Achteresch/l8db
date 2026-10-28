use super::{convex_error, deployment, ConvexDeploymentAccess};
use base64::Engine;
use futures_util::{stream, StreamExt};
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap};

const MAX_TABLES: usize = 1000;
const MAX_PAGE_SIZE: u32 = 200;
const MAX_PAGE_REQUESTS: usize = 10;
const DEFAULT_PAGE_SIZE: u32 = 50;
const MAX_FILTER_BYTES: usize = 64 * 1024;
const MAX_FILTER_CLAUSES: usize = 50;
const MAX_DOCUMENT_BYTES: usize = 1024 * 1024;
const MAX_BATCH_BYTES: usize = 8 * 1024 * 1024;
const MAX_BATCH_DOCUMENTS: usize = 1000;
const MAX_IMPORT_BYTES: usize = 8 * 1024 * 1024;
const MAX_CLEAR_PAGES: usize = 100_000;
const SAMPLE_DOCUMENTS: u32 = 200;
const ID_ALPHABET: &[u8] = b"0123456789abcdefghjkmnpqrstvwxyz";

#[derive(Serialize)]
pub struct ConvexDataTable {
    name: String,
    documents: Option<f64>,
}

#[derive(Serialize)]
pub struct ConvexDataTables {
    tables: Vec<ConvexDataTable>,
    has_more: bool,
}

#[derive(Serialize)]
pub struct ConvexDataPage {
    documents: Vec<Value>,
    cursor: Option<String>,
    has_more: bool,
}

#[derive(Serialize)]
pub struct ConvexDataResolved {
    table: String,
    document: Value,
}

#[derive(Serialize)]
pub struct ConvexDataSchema {
    has_schema: bool,
    schema_validation: bool,
    tables: Vec<Value>,
    indexes: Vec<Value>,
}

pub(crate) fn validate_table(table: &str) -> Result<&str, String> {
    let valid = !table.is_empty()
        && table.len() <= 64
        && table.as_bytes()[0].is_ascii_alphabetic()
        && table
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_');
    if valid {
        Ok(table)
    } else {
        Err("Ungültiger Tabellenname: nur Buchstaben, Ziffern und _ (max. 64 Zeichen), beginnend mit einem Buchstaben.".into())
    }
}

pub(crate) fn decode_table_number(id: &str) -> Option<u64> {
    if !(20..=64).contains(&id.len()) {
        return None;
    }
    let mut bytes = Vec::with_capacity(id.len() * 5 / 8);
    let (mut buffer, mut bits) = (0u64, 0u32);
    for character in id.bytes() {
        let digit = ID_ALPHABET.iter().position(|item| *item == character)? as u64;
        buffer = (buffer << 5) | digit;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            bytes.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    let (mut number, mut shift) = (0u64, 0u32);
    for (index, byte) in bytes.iter().enumerate() {
        if shift > 28 {
            return None;
        }
        number |= u64::from(byte & 0x7f) << shift;
        shift += 7;
        if byte & 0x80 == 0 {
            return (bytes.len() == index + 1 + 18).then_some(number);
        }
    }
    None
}

fn validate_document_id(id: &str) -> Result<&str, String> {
    decode_table_number(id)
        .map(|_| id)
        .ok_or_else(|| "Ungültige Convex-Dokument-ID.".to_string())
}

fn validate_ids(ids: &[String]) -> Result<(), String> {
    if ids.is_empty() {
        return Err("Keine Dokumente ausgewählt.".into());
    }
    if ids.len() > MAX_BATCH_DOCUMENTS {
        return Err(format!(
            "Höchstens {MAX_BATCH_DOCUMENTS} Dokumente pro Vorgang."
        ));
    }
    ids.iter()
        .try_for_each(|id| validate_document_id(id).map(|_| ()))
}

pub(crate) fn user_document(value: Value) -> Result<Map<String, Value>, String> {
    let Value::Object(mut map) = value else {
        return Err("Ein Dokument muss ein JSON-Objekt sein.".into());
    };
    map.remove("_id");
    map.remove("_creationTime");
    if let Some(key) = map.keys().find(|key| key.starts_with('_')) {
        return Err(format!(
            "Feldnamen mit _ am Anfang sind für Systemfelder reserviert: {key}"
        ));
    }
    if serde_json::to_vec(&map).map_or(0, |bytes| bytes.len()) > MAX_DOCUMENT_BYTES {
        return Err("Ein Dokument darf höchstens 1 MiB groß sein.".into());
    }
    Ok(map)
}

pub(crate) fn encode_filter(filter: &Value) -> Result<String, String> {
    let Value::Object(map) = filter else {
        return Err("Ungültiger Filter.".into());
    };
    let text = serde_json::to_string(filter).map_err(|error| error.to_string())?;
    if text.len() > MAX_FILTER_BYTES {
        return Err("Der Filter ist zu groß.".into());
    }
    if let Some(order) = map.get("order") {
        if !matches!(order.as_str(), Some("asc" | "desc")) {
            return Err("Ungültige Sortierung.".into());
        }
    }
    let clauses = map.get("clauses").and_then(Value::as_array);
    if clauses.is_some_and(|items| items.len() > MAX_FILTER_CLAUSES) {
        return Err(format!("Höchstens {MAX_FILTER_CLAUSES} Filterbedingungen."));
    }
    const OPS: [&str; 10] = [
        "eq", "neq", "gt", "gte", "lt", "lte", "type", "notype", "anyOf", "noneOf",
    ];
    for clause in clauses.into_iter().flatten() {
        let op = clause.get("op").and_then(Value::as_str).unwrap_or("");
        if !OPS.contains(&op) || clause.get("field").and_then(Value::as_str).is_none() {
            return Err("Ungültige Filterbedingung.".into());
        }
    }
    if let Some(index) = map.get("index").filter(|index| !index.is_null()) {
        let name = index.get("name").and_then(Value::as_str).unwrap_or("");
        if name.is_empty() || name.len() > 64 {
            return Err("Ungültiger Indexname.".into());
        }
        if index.get("search").is_some() && map.get("order").and_then(Value::as_str) != Some("asc")
        {
            return Err("Volltextsuche benötigt aufsteigende Sortierung.".into());
        }
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(text))
}

pub(crate) fn page_error(documents: &[Value]) -> Option<String> {
    documents.iter().find_map(|document| {
        (document.get("_id").is_none() && document.get("filter").is_some())
            .then(|| document.get("error").and_then(Value::as_str))
            .flatten()
            .map(|message| format!("Filter ungültig: {message}"))
    })
}

#[derive(Clone, PartialEq)]
enum Shape {
    Null,
    Boolean,
    Number,
    Str,
    Id(String),
    Array(Vec<Shape>),
    Object(usize, BTreeMap<String, (Vec<Shape>, usize)>),
}

fn add_shape(variants: &mut Vec<Shape>, value: &Value, tables: &HashMap<u64, String>) {
    let simple = match value {
        Value::Null => Shape::Null,
        Value::Bool(_) => Shape::Boolean,
        Value::Number(_) => Shape::Number,
        Value::String(text) => decode_table_number(text)
            .and_then(|number| tables.get(&number))
            .map_or(Shape::Str, |table| Shape::Id(table.clone())),
        Value::Array(items) => {
            let position = variants
                .iter()
                .position(|shape| matches!(shape, Shape::Array(_)))
                .unwrap_or_else(|| {
                    variants.push(Shape::Array(Vec::new()));
                    variants.len() - 1
                });
            if let Shape::Array(inner) = &mut variants[position] {
                for item in items {
                    add_shape(inner, item, tables);
                }
            }
            return;
        }
        Value::Object(map) => {
            let position = variants
                .iter()
                .position(|shape| matches!(shape, Shape::Object(..)))
                .unwrap_or_else(|| {
                    variants.push(Shape::Object(0, BTreeMap::new()));
                    variants.len() - 1
                });
            if let Shape::Object(count, fields) = &mut variants[position] {
                *count += 1;
                for (key, item) in map {
                    let entry = fields.entry(key.clone()).or_default();
                    entry.1 += 1;
                    add_shape(&mut entry.0, item, tables);
                }
            }
            return;
        }
    };
    if !variants.contains(&simple) {
        variants.push(simple);
    }
}

fn field_key(key: &str) -> String {
    let identifier = key
        .bytes()
        .next()
        .is_some_and(|byte| byte.is_ascii_alphabetic() || byte == b'_' || byte == b'$')
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$');
    if identifier {
        key.to_string()
    } else {
        Value::String(key.to_string()).to_string()
    }
}

fn render_fields(count: usize, fields: &BTreeMap<String, (Vec<Shape>, usize)>) -> Vec<String> {
    fields
        .iter()
        .map(|(key, (variants, present))| {
            let validator = render_shapes(variants);
            let validator = if *present < count {
                format!("v.optional({validator})")
            } else {
                validator
            };
            format!("{}: {validator}", field_key(key))
        })
        .collect()
}

fn render_shapes(variants: &[Shape]) -> String {
    let rendered: Vec<String> = variants.iter().map(render_shape).collect();
    match rendered.len() {
        0 => "v.any()".into(),
        1 => rendered[0].clone(),
        _ => format!("v.union({})", rendered.join(", ")),
    }
}

fn render_shape(shape: &Shape) -> String {
    match shape {
        Shape::Null => "v.null()".into(),
        Shape::Boolean => "v.boolean()".into(),
        Shape::Number => "v.number()".into(),
        Shape::Str => "v.string()".into(),
        Shape::Id(table) => format!("v.id({})", Value::String(table.clone())),
        Shape::Array(inner) => format!("v.array({})", render_shapes(inner)),
        Shape::Object(count, fields) => {
            format!(
                "v.object({{ {} }})",
                render_fields(*count, fields).join(", ")
            )
        }
    }
}

pub(crate) fn infer_table_schema(documents: &[Value], tables: &HashMap<u64, String>) -> String {
    let mut variants = Vec::new();
    for document in documents {
        let mut user = document.clone();
        if let Value::Object(map) = &mut user {
            map.remove("_id");
            map.remove("_creationTime");
        }
        add_shape(&mut variants, &user, tables);
    }
    match variants.as_slice() {
        [Shape::Object(count, fields)] if !fields.is_empty() => {
            let lines: Vec<String> = render_fields(*count, fields)
                .into_iter()
                .map(|line| format!("  {line},"))
                .collect();
            format!("defineTable({{\n{}\n}})", lines.join("\n"))
        }
        _ => "defineTable(v.any())".into(),
    }
}

async fn table_mapping(access: &ConvexDeploymentAccess) -> Result<HashMap<u64, String>, String> {
    let mapping = access
        .run_function("query", "_system/frontend/getTableMapping", json!({}))
        .await?;
    Ok(mapping
        .as_object()
        .map(|map| {
            map.iter()
                .filter_map(|(number, name)| {
                    Some((number.parse().ok()?, name.as_str()?.to_string()))
                })
                .collect()
        })
        .unwrap_or_default())
}

#[tauri::command]
pub async fn convex_studio_data_tables(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<ConvexDataTables, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let page = access
        .run_function(
            "query",
            "_system/cli/tables",
            json!({"paginationOpts": {"numItems": MAX_TABLES, "cursor": null}}),
        )
        .await?;
    let names: Vec<String> = page
        .get("page")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("name").and_then(Value::as_str))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let has_more = page.get("isDone").and_then(Value::as_bool) == Some(false);
    let access = &access;
    let mut tables: Vec<ConvexDataTable> = stream::iter(names)
        .map(|name| async move {
            let documents = access
                .run_function(
                    "query",
                    "_system/frontend/tableSize:default",
                    json!({"tableName": name}),
                )
                .await
                .ok()
                .and_then(|value| value.as_f64());
            ConvexDataTable { name, documents }
        })
        .buffer_unordered(8)
        .collect()
        .await;
    tables.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(ConvexDataTables { tables, has_more })
}

#[tauri::command]
pub async fn convex_studio_data_documents(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
    filter: Option<Value>,
    cursor: Option<String>,
    page_size: Option<u32>,
) -> Result<ConvexDataPage, String> {
    validate_table(&table)?;
    let filters = filter.as_ref().map(encode_filter).transpose()?;
    if cursor.as_ref().is_some_and(|cursor| cursor.len() > 4096) {
        return Err("Ungültiger Cursor.".into());
    }
    let size = page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let access = deployment(&id, project_id, &deployment_name).await?;
    let (mut documents, mut cursor, mut has_more) = (Vec::new(), cursor, true);
    for _ in 0..MAX_PAGE_REQUESTS {
        let result = access
            .run_function(
                "query",
                "_system/frontend/paginatedTableDocuments",
                json!({
                    "paginationOpts": {"numItems": size as usize - documents.len(), "cursor": cursor},
                    "table": table,
                    "filters": filters,
                    "componentId": null,
                }),
            )
            .await?;
        let page = result
            .get("page")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if let Some(message) = page_error(&page) {
            return Err(message);
        }
        documents.extend(page);
        has_more = result.get("isDone").and_then(Value::as_bool) == Some(false);
        cursor = result
            .get("continueCursor")
            .and_then(Value::as_str)
            .filter(|_| has_more)
            .map(str::to_string);
        if !has_more || documents.len() >= size as usize {
            break;
        }
    }
    Ok(ConvexDataPage {
        documents,
        cursor,
        has_more,
    })
}

#[tauri::command]
pub async fn convex_studio_data_resolve(
    id: String,
    project_id: u64,
    deployment_name: String,
    document_id: String,
) -> Result<ConvexDataResolved, String> {
    let number = decode_table_number(&document_id)
        .ok_or_else(|| "Ungültige Convex-Dokument-ID.".to_string())?;
    let access = deployment(&id, project_id, &deployment_name).await?;
    let table = table_mapping(&access)
        .await?
        .remove(&number)
        .ok_or_else(|| "Die Tabelle dieser ID existiert nicht.".to_string())?;
    let document = access
        .run_function(
            "query",
            "_system/frontend/getById",
            json!({"id": document_id}),
        )
        .await?;
    if document.is_null() {
        return Err("Das Dokument existiert nicht mehr.".into());
    }
    Ok(ConvexDataResolved { table, document })
}

#[tauri::command]
pub async fn convex_studio_data_insert(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
    documents: Vec<Value>,
) -> Result<usize, String> {
    validate_table(&table)?;
    if documents.is_empty() || documents.len() > MAX_BATCH_DOCUMENTS {
        return Err(format!(
            "Zwischen 1 und {MAX_BATCH_DOCUMENTS} Dokumente pro Einfügen."
        ));
    }
    let documents = documents
        .into_iter()
        .map(user_document)
        .collect::<Result<Vec<_>, _>>()?;
    if serde_json::to_vec(&documents).map_or(0, |bytes| bytes.len()) > MAX_BATCH_BYTES {
        return Err("Die Dokumente sind zusammen größer als 8 MiB.".into());
    }
    let count = documents.len();
    deployment(&id, project_id, &deployment_name)
        .await?
        .run_function(
            "mutation",
            "_system/frontend/addDocument",
            json!({"table": table, "documents": documents}),
        )
        .await?;
    Ok(count)
}

#[tauri::command]
pub async fn convex_studio_data_replace(
    id: String,
    project_id: u64,
    deployment_name: String,
    document_id: String,
    document: Value,
) -> Result<(), String> {
    validate_document_id(&document_id)?;
    let document = user_document(document)?;
    deployment(&id, project_id, &deployment_name)
        .await?
        .run_function(
            "mutation",
            "_system/frontend/replaceDocument",
            json!({"id": document_id, "document": document}),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convex_studio_data_patch(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
    ids: Vec<String>,
    fields: Value,
) -> Result<(), String> {
    validate_table(&table)?;
    validate_ids(&ids)?;
    let fields = user_document(fields)?;
    if fields.is_empty() {
        return Err("Keine Felder angegeben.".into());
    }
    deployment(&id, project_id, &deployment_name)
        .await?
        .run_function(
            "mutation",
            "_system/frontend/patchDocumentsFields",
            json!({"table": table, "ids": ids, "fields": fields}),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convex_studio_data_delete(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
    ids: Vec<String>,
) -> Result<usize, String> {
    validate_table(&table)?;
    validate_ids(&ids)?;
    let to_delete: Vec<Value> = ids
        .iter()
        .map(|id| json!({"id": id, "tableName": table}))
        .collect();
    deployment(&id, project_id, &deployment_name)
        .await?
        .run_function(
            "mutation",
            "_system/frontend/deleteDocuments",
            json!({"toDelete": to_delete}),
        )
        .await?;
    Ok(ids.len())
}

#[tauri::command]
pub async fn convex_studio_data_clear(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
) -> Result<u64, String> {
    validate_table(&table)?;
    let access = deployment(&id, project_id, &deployment_name).await?;
    let (mut cursor, mut deleted) = (Value::Null, 0u64);
    for _ in 0..MAX_CLEAR_PAGES {
        let page = access
            .run_function(
                "mutation",
                "_system/frontend/clearTablePage",
                json!({"tableName": table, "cursor": cursor}),
            )
            .await?;
        deleted += page.get("deleted").and_then(Value::as_f64).unwrap_or(0.0) as u64;
        if page.get("hasMore").and_then(Value::as_bool) != Some(true) {
            return Ok(deleted);
        }
        cursor = page.get("continueCursor").cloned().unwrap_or(Value::Null);
    }
    Err("Die Tabelle konnte nicht vollständig geleert werden.".into())
}

#[tauri::command]
pub async fn convex_studio_data_create_table(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
) -> Result<(), String> {
    validate_table(&table)?;
    deployment(&id, project_id, &deployment_name)
        .await?
        .run_function(
            "mutation",
            "_system/frontend/createTable",
            json!({"table": table}),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convex_studio_data_delete_table(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
) -> Result<(), String> {
    validate_table(&table)?;
    deployment(&id, project_id, &deployment_name)
        .await?
        .json(
            reqwest::Method::POST,
            "api/delete_tables",
            Some(&json!({"tableNames": [table], "componentId": null})),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn convex_studio_data_schema(
    id: String,
    project_id: u64,
    deployment_name: String,
) -> Result<ConvexDataSchema, String> {
    let access = deployment(&id, project_id, &deployment_name).await?;
    let (schemas, indexes) = tokio::join!(
        access.run_function("query", "_system/frontend/getSchemas", json!({})),
        access.json(reqwest::Method::GET, "api/get_indexes", None),
    );
    let active = schemas?
        .get("active")
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    let tables = active
        .as_ref()
        .and_then(|schema| schema.get("tables"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let schema_validation = active
        .as_ref()
        .and_then(|schema| schema.get("schemaValidation"))
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let indexes = indexes?
        .get("indexes")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(ConvexDataSchema {
        has_schema: active.is_some(),
        schema_validation,
        tables,
        indexes,
    })
}

#[tauri::command]
pub async fn convex_studio_data_infer_schema(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
) -> Result<String, String> {
    validate_table(&table)?;
    let access = deployment(&id, project_id, &deployment_name).await?;
    let (documents, tables) = tokio::join!(
        access.run_function(
            "query",
            "_system/frontend/listTableScan",
            json!({"table": table, "limit": SAMPLE_DOCUMENTS}),
        ),
        table_mapping(&access),
    );
    let documents = documents?.as_array().cloned().unwrap_or_default();
    Ok(infer_table_schema(&documents, &tables?))
}

#[tauri::command]
pub async fn convex_studio_data_import(
    id: String,
    project_id: u64,
    deployment_name: String,
    table: String,
    format: String,
    mode: String,
    content: String,
) -> Result<u64, String> {
    validate_table(&table)?;
    if !matches!(format.as_str(), "jsonLines" | "jsonArray" | "csv") {
        return Err("Ungültiges Importformat.".into());
    }
    if !matches!(mode.as_str(), "requireEmpty" | "append" | "replace") {
        return Err("Ungültiger Importmodus.".into());
    }
    if content.trim().is_empty() {
        return Err("Die Importdatei ist leer.".into());
    }
    if content.len() > MAX_IMPORT_BYTES {
        return Err("Importdateien dürfen höchstens 8 MiB groß sein.".into());
    }
    let access = deployment(&id, project_id, &deployment_name).await?;
    let response = access
        .request(reqwest::Method::POST, "api/import")?
        .query(&[
            ("tableName", table.as_str()),
            ("format", format.as_str()),
            ("mode", mode.as_str()),
        ])
        .header("Content-Type", "application/octet-stream")
        .body(content)
        .send()
        .await
        .map_err(|_| "Convex-Deployment ist nicht erreichbar.".to_string())?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(convex_error(status.as_u16(), &text));
    }
    Ok(serde_json::from_str::<Value>(&text)
        .ok()
        .and_then(|value| value.get("numWritten").and_then(Value::as_u64))
        .unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tables_are_validated() {
        assert!(validate_table("messages").is_ok());
        assert!(validate_table("user_2").is_ok());
        assert!(validate_table("_storage").is_err());
        assert!(validate_table("2x").is_err());
        assert!(validate_table("a-b").is_err());
        assert!(validate_table("").is_err());
        assert!(validate_table(&"a".repeat(65)).is_err());
    }

    #[test]
    fn ids_decode_to_table_numbers() {
        assert_eq!(
            decode_table_number("j57cb52st5g78d9rmyjy0sb8m58gs6m2"),
            Some(10001)
        );
        assert_eq!(decode_table_number("j57cb52st5g78d9rmyjy0sb8m58gs6m"), None);
        assert_eq!(
            decode_table_number("j57cb52st5g78d9rmyjy0sb8m58gs6mi"),
            None
        );
        assert_eq!(decode_table_number("hello"), None);
        assert!(validate_ids(&[]).is_err());
        assert!(validate_ids(&["x".into()]).is_err());
        assert!(validate_ids(&["j57cb52st5g78d9rmyjy0sb8m58gs6m2".into()]).is_ok());
    }

    #[test]
    fn user_documents_drop_system_fields() {
        let map = user_document(json!({"_id": "x", "_creationTime": 1, "a": 1})).unwrap();
        assert_eq!(Value::Object(map), json!({"a": 1}));
        assert!(user_document(json!([1])).is_err());
        assert!(user_document(json!({"_secret": 1})).is_err());
        assert!(user_document(json!({"a": "x".repeat(MAX_DOCUMENT_BYTES)})).is_err());
    }

    #[test]
    fn filters_are_checked_and_encoded() {
        let filter = json!({"clauses": [{"op": "gte", "field": "likes", "value": 5, "enabled": true, "id": "0"}], "order": "desc"});
        let encoded = encode_filter(&filter).unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&decoded).unwrap(), filter);
        assert!(encode_filter(&json!([])).is_err());
        assert!(encode_filter(&json!({"order": "up"})).is_err());
        assert!(encode_filter(&json!({"clauses": [{"op": "drop", "field": "a"}]})).is_err());
        assert!(encode_filter(
            &json!({"order": "desc", "index": {"name": "search_body", "search": "x", "clauses": []}})
        )
        .is_err());
        assert!(encode_filter(
            &json!({"order": "asc", "index": {"name": "search_body", "search": "x", "clauses": []}})
        )
        .is_ok());
    }

    #[test]
    fn page_errors_are_detected() {
        assert_eq!(
            page_error(&[json!({"error": "boom", "filter": -1})]).as_deref(),
            Some("Filter ungültig: boom")
        );
        assert!(page_error(&[json!({"_id": "x", "filter": 1})]).is_none());
    }

    #[test]
    fn schema_is_inferred_from_documents() {
        let tables = HashMap::from([(10001, "messages".to_string())]);
        let documents = [
            json!({"_id": "a", "_creationTime": 1.0, "name": "x", "n": 1, "tags": ["a"], "ref": "j57cb52st5g78d9rmyjy0sb8m58gs6m2", "nested": {"a": 1}}),
            json!({"name": "y", "n": null, "tags": [], "nested": {"a": 2, "b": true}, "with-dash": 1}),
        ];
        assert_eq!(
            infer_table_schema(&documents, &tables),
            "defineTable({\n  n: v.union(v.number(), v.null()),\n  name: v.string(),\n  nested: v.object({ a: v.number(), b: v.optional(v.boolean()) }),\n  ref: v.optional(v.id(\"messages\")),\n  tags: v.array(v.string()),\n  \"with-dash\": v.optional(v.number()),\n})"
        );
        assert_eq!(infer_table_schema(&[], &tables), "defineTable(v.any())");
    }

    #[tokio::test]
    #[ignore]
    async fn convex_studio_data_live() {
        use crate::baas_self_hosted_live_tests::{env, isolate_secrets, latency};
        let (Some(url), Some(key)) = (env("L8DB_E2E_CONVEX_URL"), env("L8DB_E2E_CONVEX_KEY"))
        else {
            return;
        };
        let _secrets = isolate_secrets();
        let profile = crate::convex::convex_connect_self_hosted(url, key)
            .await
            .unwrap();
        let id = profile.id.clone();
        let deployment = || String::new();

        let tables = convex_studio_data_tables(id.clone(), 0, deployment())
            .await
            .unwrap();
        let messages = tables
            .tables
            .iter()
            .find(|table| table.name == "messages")
            .unwrap();
        assert!(messages.documents.unwrap() >= 1.0);
        latency("convex data tables", 500, || async {
            convex_studio_data_tables(id.clone(), 0, deployment())
                .await
                .unwrap();
        })
        .await;

        let first = convex_studio_data_documents(
            id.clone(),
            0,
            deployment(),
            "messages".into(),
            None,
            None,
            Some(20),
        )
        .await
        .unwrap();
        assert_eq!(first.documents.len(), 20);
        assert!(first.has_more);
        let second = convex_studio_data_documents(
            id.clone(),
            0,
            deployment(),
            "messages".into(),
            Some(json!({"clauses": [], "order": "desc"})),
            first.cursor.clone(),
            Some(20),
        )
        .await
        .unwrap();
        assert_ne!(first.documents[0]["_id"], second.documents[0]["_id"]);
        latency("convex data page", 500, || async {
            convex_studio_data_documents(
                id.clone(),
                0,
                deployment(),
                "messages".into(),
                None,
                None,
                Some(50),
            )
            .await
            .unwrap();
        })
        .await;

        let filtered = convex_studio_data_documents(
            id.clone(),
            0,
            deployment(),
            "messages".into(),
            Some(json!({"clauses": [{"op": "gte", "field": "likes", "value": 3, "enabled": true, "id": "0"}], "order": "asc", "index": {"name": "by_author", "clauses": [{"type": "indexEq", "enabled": true, "value": "Grace"}]}})),
            None,
            Some(50),
        )
        .await
        .unwrap();
        assert!(filtered
            .documents
            .iter()
            .all(|doc| doc["author"] == "Grace" && doc["likes"].as_f64().unwrap() >= 3.0));
        let searched = convex_studio_data_documents(
            id.clone(),
            0,
            deployment(),
            "messages".into(),
            Some(json!({"clauses": [], "order": "asc", "index": {"name": "search_body", "search": "search", "clauses": []}})),
            None,
            Some(50),
        )
        .await
        .unwrap();
        assert!(!searched.documents.is_empty());
        assert!(convex_studio_data_documents(
            id.clone(),
            0,
            deployment(),
            "messages".into(),
            Some(json!({"order": "desc", "index": {"name": "search_body", "search": "x", "clauses": []}})),
            None,
            None,
        )
        .await
        .is_err());

        let target = first.documents[0]["_id"].as_str().unwrap().to_string();
        let resolved = convex_studio_data_resolve(id.clone(), 0, deployment(), target.clone())
            .await
            .unwrap();
        assert_eq!(resolved.table, "messages");
        assert_eq!(resolved.document["_id"], target.as_str());
        latency("convex data resolve", 500, || async {
            convex_studio_data_resolve(id.clone(), 0, deployment(), target.clone())
                .await
                .unwrap();
        })
        .await;

        let schema = convex_studio_data_schema(id.clone(), 0, deployment())
            .await
            .unwrap();
        assert!(schema.has_schema);
        assert!(schema
            .tables
            .iter()
            .any(|table| table["tableName"] == "messages"));
        assert!(schema
            .indexes
            .iter()
            .any(|index| index["name"] == "search_body"));
        latency("convex data schema", 500, || async {
            convex_studio_data_schema(id.clone(), 0, deployment())
                .await
                .unwrap();
        })
        .await;
        let inferred =
            convex_studio_data_infer_schema(id.clone(), 0, deployment(), "messages".into())
                .await
                .unwrap();
        assert!(inferred.contains("author: v.string()"), "{inferred}");

        let scratch = format!(
            "l8db_scratch_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        );
        convex_studio_data_create_table(id.clone(), 0, deployment(), scratch.clone())
            .await
            .unwrap();
        assert_eq!(
            convex_studio_data_insert(
                id.clone(),
                0,
                deployment(),
                scratch.clone(),
                vec![json!({"a": 1, "_id": "ignored"}), json!({"a": 2})],
            )
            .await
            .unwrap(),
            2
        );
        let page = convex_studio_data_documents(
            id.clone(),
            0,
            deployment(),
            scratch.clone(),
            Some(json!({"clauses": [], "order": "asc"})),
            None,
            None,
        )
        .await
        .unwrap();
        assert_eq!(page.documents.len(), 2);
        let first_id = page.documents[0]["_id"].as_str().unwrap().to_string();
        let second_id = page.documents[1]["_id"].as_str().unwrap().to_string();
        convex_studio_data_replace(
            id.clone(),
            0,
            deployment(),
            first_id.clone(),
            json!({"b": "x"}),
        )
        .await
        .unwrap();
        convex_studio_data_patch(
            id.clone(),
            0,
            deployment(),
            scratch.clone(),
            vec![second_id.clone()],
            json!({"c": true}),
        )
        .await
        .unwrap();
        let replaced = convex_studio_data_resolve(id.clone(), 0, deployment(), first_id.clone())
            .await
            .unwrap();
        assert_eq!(replaced.document["b"], "x");
        assert!(replaced.document.get("a").is_none());
        let patched = convex_studio_data_resolve(id.clone(), 0, deployment(), second_id.clone())
            .await
            .unwrap();
        assert_eq!(patched.document["c"], true);
        assert_eq!(patched.document["a"], 2.0);
        assert_eq!(
            convex_studio_data_delete(id.clone(), 0, deployment(), scratch.clone(), vec![first_id])
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            convex_studio_data_import(
                id.clone(),
                0,
                deployment(),
                scratch.clone(),
                "jsonLines".into(),
                "append".into(),
                "{\"x\":1}\n{\"x\":2}\n".into(),
            )
            .await
            .unwrap(),
            2
        );
        assert!(convex_studio_data_import(
            id.clone(),
            0,
            deployment(),
            scratch.clone(),
            "csv".into(),
            "requireEmpty".into(),
            "x\n1\n".into(),
        )
        .await
        .is_err());
        assert_eq!(
            convex_studio_data_import(
                id.clone(),
                0,
                deployment(),
                scratch.clone(),
                "csv".into(),
                "replace".into(),
                "x,y\n1,a\n2,b\n3,c\n".into(),
            )
            .await
            .unwrap(),
            3
        );
        assert_eq!(
            convex_studio_data_clear(id.clone(), 0, deployment(), scratch.clone())
                .await
                .unwrap(),
            3
        );
        convex_studio_data_delete_table(id.clone(), 0, deployment(), scratch.clone())
            .await
            .unwrap();
        let after = convex_studio_data_tables(id.clone(), 0, deployment())
            .await
            .unwrap();
        assert!(after.tables.iter().all(|table| table.name != scratch));
        assert!(
            convex_studio_data_create_table(id.clone(), 0, deployment(), "_bad".into())
                .await
                .is_err()
        );
        crate::convex::convex_disconnect(id).await.unwrap();
    }
}
