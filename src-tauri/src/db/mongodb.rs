use std::collections::BTreeMap;

use async_trait::async_trait;
use futures_util::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::Client;

use super::pool::PoolState;
use super::{
    timed, unsupported, ColumnInfo, CreateTableRequest, DatabaseAdapter, DetailedColumnInfo,
    IndexInfo, QueryResult, TableData, TableInfo,
};

pub struct MongoAdapter {
    uri: String,
    database: Option<String>,
    pool_state: PoolState,
    key: String,
}

fn map_err(e: mongodb::error::Error) -> String {
    format!("MongoDB: {e}")
}

fn to_json(bson: Bson) -> serde_json::Value {
    match bson {
        Bson::Int64(value)
            if !(-9_007_199_254_740_991..=9_007_199_254_740_991).contains(&value) =>
        {
            serde_json::json!({ "$numberLong": value.to_string() })
        }
        Bson::Document(document) => serde_json::Value::Object(
            document
                .into_iter()
                .map(|(key, value)| (key, to_json(value)))
                .collect(),
        ),
        Bson::Array(values) => serde_json::Value::Array(values.into_iter().map(to_json).collect()),
        value => value.into_relaxed_extjson(),
    }
}

pub(crate) fn parse_document(input: &str, what: &str) -> Result<Document, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Ok(Document::new());
    }
    let value: serde_json::Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("{what} muss gültiges JSON sein: {e}"))?;
    match Bson::try_from(value).map_err(|e| format!("{what} konnte nicht gelesen werden: {e}"))? {
        Bson::Document(document) => Ok(document),
        _ => Err(format!("{what} muss ein JSON-Objekt sein")),
    }
}

fn bson_type(value: &Bson) -> &'static str {
    match value {
        Bson::Double(_) => "double",
        Bson::String(_) => "string",
        Bson::Array(_) => "array",
        Bson::Document(_) => "object",
        Bson::Boolean(_) => "bool",
        Bson::Null => "null",
        Bson::RegularExpression(_) => "regex",
        Bson::JavaScriptCode(_) | Bson::JavaScriptCodeWithScope(_) => "javascript",
        Bson::Int32(_) => "int",
        Bson::Int64(_) => "long",
        Bson::Timestamp(_) => "timestamp",
        Bson::Binary(_) => "binData",
        Bson::ObjectId(_) => "objectId",
        Bson::DateTime(_) => "date",
        Bson::Symbol(_) => "symbol",
        Bson::Decimal128(_) => "decimal",
        Bson::Undefined => "undefined",
        Bson::MaxKey => "maxKey",
        Bson::MinKey => "minKey",
        Bson::DbPointer(_) => "dbPointer",
    }
}

impl MongoAdapter {
    pub fn new(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
        key: String,
    ) -> Result<Self, String> {
        let trimmed = connection_string.trim();
        if !(trimmed.starts_with("mongodb://") || trimmed.starts_with("mongodb+srv://")) {
            return Err("Eine mongodb:// oder mongodb+srv:// URL ist erforderlich".to_string());
        }
        Ok(Self {
            uri: trimmed.to_string(),
            database: database.filter(|d| !d.is_empty()).map(str::to_string),
            pool_state,
            key,
        })
    }

    async fn client(&self) -> Result<Client, String> {
        let uri = self.uri.clone();
        let shared = self
            .pool_state
            .shared(
                &format!(
                    "{}#connect-{}",
                    self.key,
                    super::execution::connection_duration().as_secs()
                ),
                || async move {
                    let mut options = mongodb::options::ClientOptions::parse(&uri)
                        .await
                        .map_err(map_err)?;
                    options.server_selection_timeout =
                        Some(super::execution::connection_duration());
                    options.connect_timeout = Some(super::execution::connection_duration());
                    options.app_name.get_or_insert_with(|| "l8db".to_string());
                    Client::with_options(options).map_err(map_err)
                },
            )
            .await?;
        Ok((*shared).clone())
    }

    async fn database_name(&self, client: &Client) -> Result<String, String> {
        if let Some(db) = &self.database {
            return Ok(db.clone());
        }
        client
            .default_database()
            .map(|d| d.name().to_string())
            .ok_or_else(|| "Kein Datenbankname in der URL. Wähle eine Datenbank.".to_string())
    }

    async fn sample_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<(String, String, bool)>, String> {
        let client = self.client().await?;
        let coll = client.database(schema).collection::<Document>(table);
        let mut cursor =
            timed(async { coll.find(doc! {}).limit(50).await.map_err(map_err) }).await?;
        let mut seen: BTreeMap<String, (String, usize, bool)> = BTreeMap::new();
        let mut total = 0usize;
        while let Some(document) = cursor.try_next().await.map_err(map_err)? {
            total += 1;
            for (key, value) in document {
                let entry = seen
                    .entry(key)
                    .or_insert_with(|| (bson_type(&value).to_string(), 0, false));
                entry.1 += 1;
                entry.2 |= matches!(value, Bson::Null);
                if entry.0 == "null" {
                    entry.0 = bson_type(&value).to_string();
                }
            }
        }
        let mut columns: Vec<(String, String, bool)> = seen
            .into_iter()
            .map(|(name, (ty, count, null))| (name, ty, null || count < total))
            .collect();
        columns.sort_by_key(|(name, _, _)| {
            if name == "_id" {
                String::new()
            } else {
                name.clone()
            }
        });
        Ok(columns)
    }
}

#[async_trait]
impl DatabaseAdapter for MongoAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database("admin")
                .run_command(doc! { "ping": 1 })
                .await
                .map_err(map_err)
                .map(|_| ())
        })
        .await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let client = self.client().await?;
        timed(async { client.list_database_names().await.map_err(map_err) }).await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let client = self.client().await?;
        Ok(vec![self.database_name(&client).await?])
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let client = self.client().await?;
        let db = match schema {
            Some(s) => s.to_string(),
            None => self.database_name(&client).await?,
        };
        let mut names = timed(async {
            client
                .database(&db)
                .list_collection_names()
                .await
                .map_err(map_err)
        })
        .await?;
        names.retain(|n| !n.starts_with("system."));
        names.sort();
        Ok(names
            .into_iter()
            .map(|name| TableInfo {
                schema: db.clone(),
                name,
            })
            .collect())
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        if table_type.is_some_and(|t| t.eq_ignore_ascii_case("view")) {
            return Ok(vec![]);
        }
        let tables = match table {
            Some(t) => vec![TableInfo {
                schema: match schema {
                    Some(schema) => schema.to_string(),
                    None => self.database_name(&self.client().await?).await?,
                },
                name: t.to_string(),
            }],
            None => self.list_tables(schema).await?,
        };
        let mut out = Vec::new();
        for t in tables {
            for (name, data_type, _) in self.sample_columns(&t.schema, &t.name).await? {
                out.push(ColumnInfo {
                    schema: t.schema.clone(),
                    table: t.name.clone(),
                    name,
                    data_type,
                });
            }
        }
        Ok(out)
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        Ok(self
            .sample_columns(schema, table)
            .await?
            .into_iter()
            .enumerate()
            .map(|(i, (name, data_type, nullable))| DetailedColumnInfo {
                is_primary_key: name == "_id",
                name,
                data_type,
                is_nullable: nullable,
                column_default: None,
                ordinal_position: i as i32 + 1,
                character_maximum_length: None,
                comment: None,
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
        _allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let client = self.client().await?;
        let query = parse_document(filter.unwrap_or(""), "Der Filter")?;
        let coll = client.database(schema).collection::<Document>(table);
        if limit <= 0 {
            return Ok(TableData {
                columns: self
                    .sample_columns(schema, table)
                    .await?
                    .into_iter()
                    .map(|(name, _, _)| name)
                    .collect(),
                rows: vec![],
            });
        }
        let mut find = coll
            .find(query)
            .skip(offset.max(0) as u64)
            .limit(limit.max(0));
        if let Some(field) = order_by {
            find = find.sort(doc! { field: if order_desc { -1 } else { 1 } });
        }
        let mut cursor = timed(async { find.await.map_err(map_err) }).await?;
        let mut documents: Vec<serde_json::Value> = Vec::new();
        let mut columns: Vec<String> = vec!["_id".to_string()];
        while let Some(document) = cursor.try_next().await.map_err(map_err)? {
            for key in document.keys() {
                if !columns.contains(key) {
                    columns.push(key.clone());
                }
            }
            documents.push(to_json(Bson::Document(document)));
        }
        if documents.is_empty() {
            columns = self
                .sample_columns(schema, table)
                .await?
                .into_iter()
                .map(|(n, _, _)| n)
                .collect();
            if columns.is_empty() {
                columns.push("_id".to_string());
            }
        }
        Ok(TableData {
            columns,
            rows: documents,
        })
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        _allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let client = self.client().await?;
        let coll = client.database(schema).collection::<Document>(table);
        let query = parse_document(filter.unwrap_or(""), "Der Filter")?;
        timed(async {
            if query.is_empty() {
                coll.estimated_document_count()
                    .await
                    .map(|n| n as i64)
                    .map_err(map_err)
            } else {
                coll.count_documents(query)
                    .await
                    .map(|n| n as i64)
                    .map_err(map_err)
            }
        })
        .await
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let client = self.client().await?;
        let start = std::time::Instant::now();
        let command = match super::mongo_shell::to_command(sql) {
            Some(command) => command?,
            None => parse_document(sql, "Der Befehl")?,
        };
        if command.is_empty() {
            return Err("Gib ein MongoDB-Befehlsdokument ein, z. B. {\"find\": \"users\", \"filter\": {}} oder {\"aggregate\": \"orders\", \"pipeline\": [], \"cursor\": {}}".to_string());
        }
        let db = self.database_name(&client).await?;
        let mut command = command;
        if command.contains_key("aggregate") && !command.contains_key("cursor") {
            command.insert("cursor", doc! {});
        }
        let cursor_command = command.keys().next().is_some_and(|name| {
            matches!(
                name.as_str(),
                "find" | "aggregate" | "listCollections" | "listIndexes"
            )
        });
        let (result, batch) = if cursor_command {
            let items = timed(async {
                let cursor = client
                    .database(&db)
                    .run_cursor_command(command)
                    .await
                    .map_err(map_err)?;
                cursor.try_collect::<Vec<Document>>().await.map_err(map_err)
            })
            .await?;
            (
                Document::new(),
                Some(items.into_iter().map(Bson::Document).collect::<Vec<_>>()),
            )
        } else {
            let result = timed(async {
                client
                    .database(&db)
                    .run_command(command)
                    .await
                    .map_err(map_err)
            })
            .await?;
            if let Ok(errors) = result.get_array("writeErrors") {
                if !errors.is_empty() {
                    return Err(format!("MongoDB: {}", to_json(Bson::Array(errors.clone()))));
                }
            }
            if let Ok(error) = result.get_document("writeConcernError") {
                return Err(format!(
                    "MongoDB: {}",
                    to_json(Bson::Document(error.clone()))
                ));
            }
            let batch = result.get_array("documents").ok().cloned();
            (result, batch)
        };
        let (columns, rows) = match batch {
            Some(items) => {
                let mut columns: Vec<String> = Vec::new();
                let rows: Vec<serde_json::Value> = items
                    .into_iter()
                    .map(|item| {
                        if let Bson::Document(d) = &item {
                            for key in d.keys() {
                                if !columns.contains(key) {
                                    columns.push(key.clone());
                                }
                            }
                        }
                        to_json(item)
                    })
                    .collect();
                (columns, rows)
            }
            None => {
                let columns: Vec<String> = result.keys().cloned().collect();
                (columns, vec![to_json(Bson::Document(result))])
            }
        };
        let affected = (!cursor_command)
            .then(|| rows.first())
            .flatten()
            .and_then(|r| r.get("n"))
            .and_then(|n| n.as_u64());
        Ok(QueryResult {
            columns,
            rows,
            rows_affected: affected,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database(schema)
                .collection::<Document>(table)
                .drop()
                .await
                .map_err(map_err)
        })
        .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database(schema)
                .collection::<Document>(table)
                .delete_many(doc! {})
                .await
                .map_err(map_err)
                .map(|_| ())
        })
        .await
    }

    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let client = self.client().await?;
        timed(async {
            client
                .database(&req.schema)
                .create_collection(&req.name)
                .await
                .map_err(map_err)
        })
        .await
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let client = self.client().await?;
        let mut cursor = timed(async {
            client
                .database(schema)
                .collection::<Document>(table)
                .list_indexes()
                .await
                .map_err(map_err)
        })
        .await?;
        let mut out = Vec::new();
        while let Some(index) = cursor.try_next().await.map_err(map_err)? {
            let name = index
                .options
                .as_ref()
                .and_then(|o| o.name.clone())
                .unwrap_or_default();
            let columns: Vec<String> = index
                .keys
                .iter()
                .map(|(k, v)| format!("{k} {}", to_json(v.clone())))
                .collect();
            out.push(IndexInfo {
                is_primary: name == "_id_",
                is_unique: index
                    .options
                    .as_ref()
                    .and_then(|o| o.unique)
                    .unwrap_or(false)
                    || name == "_id_",
                index_type: index
                    .keys
                    .values()
                    .find_map(Bson::as_str)
                    .unwrap_or("btree")
                    .to_string(),
                definition: to_json(Bson::Document(index.keys.clone())).to_string(),
                columns,
                name,
            })
        }
        Ok(out)
    }

    async fn list_import_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<super::ImportColumnInfo>, String> {
        Ok(self
            .sample_columns(schema, table)
            .await?
            .into_iter()
            .enumerate()
            .map(|(i, (name, data_type, _))| super::ImportColumnInfo {
                has_default: name == "_id",
                name,
                data_type,
                is_nullable: true,
                is_identity: false,
                is_generated: false,
                ordinal_position: i as i32 + 1,
            })
            .collect())
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<super::ConstraintInfo>, String> {
        Ok(self
            .list_indexes(schema, table)
            .await?
            .into_iter()
            .filter(|index| index.is_unique)
            .map(|index| super::ConstraintInfo {
                constraint_type: if index.is_primary {
                    "PRIMARY KEY".into()
                } else {
                    "UNIQUE".into()
                },
                columns: index
                    .columns
                    .iter()
                    .filter_map(|column| column.rsplit_once(' ').map(|(name, _)| name.to_string()))
                    .collect(),
                definition: index.definition,
                name: index.name,
            })
            .collect())
    }

    async fn csv_import(
        &self,
        request: &super::CsvImportRequest,
    ) -> Result<super::CsvImportOutcome, String> {
        super::import::validate_request(request)?;
        let client = self.client().await?;
        let collection = client
            .database(&request.schema)
            .collection::<Document>(&request.table);
        let conflict = match &request.conflict {
            Some(conflict) => {
                let keys = self
                    .list_constraints(&request.schema, &request.table)
                    .await?
                    .into_iter()
                    .find(|constraint| constraint.name == conflict.constraint)
                    .map(|constraint| constraint.columns)
                    .ok_or("Konfliktziel muss ein eindeutiger Index sein.")?;
                if keys.is_empty() || keys.iter().any(|key| !request.columns.contains(key)) {
                    return Err("Alle Konfliktschlüssel müssen zugeordnet sein.".into());
                }
                Some((keys, conflict.update_columns.clone()))
            }
            None => None,
        };
        let rows: super::import_source::RowStream = match &request.file {
            Some(source) => super::import_source::open_rows(source)?,
            None => Box::new(request.rows.clone().into_iter().map(Ok)),
        };
        let mut counts = super::import::Counts::default();
        let mut batch: Vec<Document> = Vec::new();
        let mut processed = 0usize;
        let mut failure: Option<(Option<u32>, String)> = None;
        let mut iterator = rows.enumerate();
        loop {
            let next = iterator.next();
            if let Some((index, row)) = &next {
                match row {
                    Ok(row) => {
                        batch.push(import_document(&request.columns, row));
                        processed = index + 1;
                    }
                    Err(error) => {
                        failure = Some((Some(*index as u32 + 1), error.clone()));
                    }
                }
            }
            let full = batch.len() >= 1000;
            if failure.is_none() && !batch.is_empty() && (full || next.is_none()) {
                if super::execution::cancellation_token().is_cancelled() {
                    failure = Some((None, "Import vom Benutzer abgebrochen.".into()));
                } else {
                    let start = processed - batch.len();
                    let documents = std::mem::take(&mut batch);
                    if let Err(error) =
                        write_documents(&collection, documents, conflict.as_ref(), &mut counts)
                            .await
                    {
                        failure = Some((Some(start as u32 + 1), error));
                    }
                    super::execution::progress(processed as u64);
                }
            }
            if failure.is_some() || next.is_none() {
                break;
            }
        }
        Ok(super::CsvImportOutcome {
            inserted_rows: counts.inserted,
            updated_rows: counts.updated,
            skipped_rows: counts.skipped,
            failed_row: failure.as_ref().and_then(|(row, _)| *row),
            failed_column: None,
            error: failure.map(|(_, message)| {
                format!(
                    "{message} Keine Transaktion: {} bereits geschriebene Dokument(e) bleiben erhalten.",
                    counts.inserted + counts.updated
                )
            }),
        })
    }

    async fn create_schema(&self, _name: &str) -> Result<(), String> {
        Err(unsupported(
            "Datenbanken werden bei der ersten Collection automatisch angelegt",
        ))
    }

    async fn drop_schema(&self, name: &str, _cascade: bool) -> Result<(), String> {
        let client = self.client().await?;
        timed(async { client.database(name).drop().await.map_err(map_err) }).await
    }
}

pub(crate) fn import_value(key: &str, text: &str) -> Bson {
    let trimmed = text.trim();
    if key == "_id" && trimmed.len() == 24 {
        if let Ok(id) = mongodb::bson::oid::ObjectId::parse_str(trimmed) {
            return Bson::ObjectId(id);
        }
    }
    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Ok(bson) = Bson::try_from(value) {
                return bson;
            }
        }
    }
    match trimmed {
        "true" => return Bson::Boolean(true),
        "false" => return Bson::Boolean(false),
        _ => {}
    }
    let numeric = !trimmed.is_empty()
        && trimmed == text
        && serde_json::from_str::<serde_json::Number>(trimmed).is_ok();
    if numeric {
        if let Ok(value) = trimmed.parse::<i64>() {
            return i32::try_from(value)
                .map(Bson::Int32)
                .unwrap_or(Bson::Int64(value));
        }
        if let Ok(value) = trimmed.parse::<f64>() {
            return Bson::Double(value);
        }
    }
    Bson::String(text.to_string())
}

fn import_document(columns: &[String], row: &[Option<String>]) -> Document {
    let mut document = Document::new();
    for (column, value) in columns.iter().zip(row) {
        if let Some(value) = value {
            document.insert(column.clone(), import_value(column, value));
        }
    }
    document
}

async fn write_documents(
    collection: &mongodb::Collection<Document>,
    documents: Vec<Document>,
    conflict: Option<&(Vec<String>, Vec<String>)>,
    counts: &mut super::import::Counts,
) -> Result<(), String> {
    let Some((keys, updates)) = conflict else {
        let total = documents.len() as u64;
        timed(async { collection.insert_many(documents).await.map_err(map_err) }).await?;
        counts.inserted += total;
        return Ok(());
    };
    for document in documents {
        let mut filter = Document::new();
        for key in keys {
            filter.insert(
                key.clone(),
                document.get(key).cloned().unwrap_or(Bson::Null),
            );
        }
        let mut set = Document::new();
        let mut on_insert = Document::new();
        for (key, value) in document {
            if updates.contains(&key) {
                set.insert(key, value);
            } else if !keys.contains(&key) {
                on_insert.insert(key, value);
            }
        }
        let mut update = doc! {};
        if !set.is_empty() {
            update.insert("$set", set);
        }
        if !on_insert.is_empty() {
            update.insert("$setOnInsert", on_insert);
        }
        if update.is_empty() {
            update.insert("$setOnInsert", filter.clone());
        }
        let result = timed(async {
            collection
                .update_one(filter, update)
                .upsert(true)
                .await
                .map_err(map_err)
        })
        .await?;
        if result.upserted_id.is_some() {
            counts.inserted += 1;
        } else if !updates.is_empty() {
            counts.updated += 1;
        } else {
            counts.skipped += 1;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn import_values_are_typed() {
        assert_eq!(import_value("n", "42"), Bson::Int32(42));
        assert_eq!(import_value("n", "9999999999"), Bson::Int64(9_999_999_999));
        assert_eq!(import_value("n", "1.5"), Bson::Double(1.5));
        assert_eq!(import_value("n", "01234"), Bson::String("01234".into()));
        assert_eq!(import_value("n", " 7"), Bson::String(" 7".into()));
        assert_eq!(import_value("b", "true"), Bson::Boolean(true));
        assert!(matches!(
            import_value("_id", "65a1b2c3d4e5f60718293a4b"),
            Bson::ObjectId(_)
        ));
        assert!(matches!(
            import_value("o", "{\"a\": [1]}"),
            Bson::Document(_)
        ));
        let document = import_document(&["a".into(), "b".into()], &[Some("x".into()), None]);
        assert_eq!(document, doc! { "a": "x" });
    }

    #[test]
    fn parses_filters() {
        assert!(parse_document("", "x").unwrap().is_empty());
        assert_eq!(
            parse_document("{\"a\": 1}", "x")
                .unwrap()
                .get_i32("a")
                .unwrap(),
            1
        );
        assert!(parse_document("a = 1", "x").is_err());
        assert!(MongoAdapter::new(
            "mysql://x",
            None,
            crate::db::pool::create_pool_state(),
            "k".into()
        )
        .is_err());
        assert!(MongoAdapter::new(
            "mongodb+srv://cs-admin:XXX@cXXX.mongodb.net/",
            None,
            crate::db::pool::create_pool_state(),
            "srv".into()
        )
        .is_ok());
    }

    #[test]
    fn extended_json_is_relaxed() {
        let json = to_json(Bson::Document(
            doc! { "n": 1i64, "t": mongodb::bson::DateTime::from_millis(0) },
        ));
        assert_eq!(json["n"], 1);
        assert_eq!(json["t"]["$date"], "1970-01-01T00:00:00Z");
    }
}

#[cfg(test)]
#[path = "mongodb_tests.rs"]
mod integration_tests;

#[cfg(test)]
#[path = "mongodb_browser_tests.rs"]
mod browser_tests;
