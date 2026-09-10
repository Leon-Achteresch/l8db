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

fn parse_document(input: &str, what: &str) -> Result<Document, String> {
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
            .shared(&self.key, || async move {
                let mut options = mongodb::options::ClientOptions::parse(&uri)
                    .await
                    .map_err(map_err)?;
                options.server_selection_timeout = Some(std::time::Duration::from_secs(10));
                options.connect_timeout = Some(std::time::Duration::from_secs(10));
                options.app_name.get_or_insert_with(|| "l8db".to_string());
                Client::with_options(options).map_err(map_err)
            })
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
        let command = parse_document(sql, "Der Befehl")?;
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

#[cfg(test)]
mod tests {
    use super::*;

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
