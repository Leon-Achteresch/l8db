use super::client::remote;
use crate::db::{execution, ColumnInfo, DatabaseAdapter, QueryResult, TableData, TableInfo};
use async_trait::async_trait;
use serde_json::{json, Value};

pub struct WorkspaceAdapter {
    profile: String,
    connection: String,
    database: Option<String>,
}

fn string(value: &Value, key: &str) -> String {
    value[key].as_str().unwrap_or_default().to_string()
}
fn array(value: Value) -> Result<Vec<Value>, String> {
    value
        .as_array()
        .cloned()
        .ok_or("Workspace hat ein ungültiges Ergebnis gesendet.".into())
}

impl WorkspaceAdapter {
    pub fn new(raw: &str, database: Option<&str>) -> Result<Self, String> {
        let url = url::Url::parse(raw).map_err(|_| "Workspace-Verbindung ungültig")?;
        let profile = url
            .host_str()
            .filter(|value| !value.is_empty())
            .ok_or("Workspace-Profil fehlt")?
            .to_string();
        let connection = url.path().trim_matches('/').to_string();
        if url.scheme() != "workspace"
            || connection.is_empty()
            || connection.contains('/')
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("Workspace-Verbindung ungültig.".into());
        }
        Ok(Self {
            profile,
            connection,
            database: database.map(str::to_owned),
        })
    }

    async fn metadata(&self, mut body: Value) -> Result<Value, String> {
        body["database"] = json!(self.database);
        remote(
            &self.profile,
            "POST",
            &format!("api/connections/{}/metadata", self.connection),
            Some(body),
        )
        .await
    }
}

#[async_trait]
impl DatabaseAdapter for WorkspaceAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.metadata(json!({"operation":"test"})).await.map(|_| ())
    }
    async fn list_databases(&self) -> Result<Vec<String>, String> {
        Ok(
            array(self.metadata(json!({"operation":"databases"})).await?)?
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
        )
    }
    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        Ok(array(self.metadata(json!({"operation":"schemas"})).await?)?
            .iter()
            .filter_map(|v| v.as_str().map(str::to_owned))
            .collect())
    }
    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(array(
            self.metadata(json!({"operation":"tables","schema":schema}))
                .await?,
        )?
        .iter()
        .map(|v| TableInfo {
            schema: string(v, "schema"),
            name: string(v, "name"),
        })
        .collect())
    }
    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        Ok(array(
            self.metadata(json!({"operation":"views","schema":schema}))
                .await?,
        )?
        .iter()
        .map(|v| TableInfo {
            schema: string(v, "schema"),
            name: string(v, "name"),
        })
        .collect())
    }
    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        _: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        Ok(array(
            self.metadata(json!({"operation":"columns","schema":schema,"table":table}))
                .await?,
        )?
        .iter()
        .map(|v| ColumnInfo {
            schema: string(v, "schema"),
            table: string(v, "table"),
            name: string(v, "name"),
            data_type: string(v, "data_type"),
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
        is_view: bool,
        _: bool,
    ) -> Result<TableData, String> {
        let value=self.metadata(json!({"operation":"rows","schema":schema,"table":table,"filter":filter,"limit":limit,"offset":offset,"orderBy":order_by,"orderDesc":order_desc,"isView":is_view})).await?;
        Ok(TableData {
            columns: value["columns"]
                .as_array()
                .ok_or("Ergebnisspalten fehlen")?
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            rows: value["rows"]
                .as_array()
                .ok_or("Ergebniszeilen fehlen")?
                .clone(),
        })
    }
    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        _: bool,
    ) -> Result<i64, String> {
        self.metadata(json!({"operation":"count","schema":schema,"table":table,"filter":filter}))
            .await?
            .as_i64()
            .ok_or("Workspace hat keine gültige Zeilenanzahl zurückgegeben.".into())
    }
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let job = super::crypto::id()?;
        let query_path = format!("api/connections/{}/query", self.connection);
        let pending = remote(
            &self.profile,
            "POST",
            &query_path,
            Some(
                json!({"sql":sql,"jobId":job,"maxRows":execution::row_limit().min(super::model::MAX_RESULT_ROWS)}),
            ),
        );
        let cancel = execution::cancellation_token();
        let value = tokio::select! {
            result=pending=>result?,
            _=cancel.cancelled()=>{
                let _=remote(&self.profile,"POST",&format!("api/connections/{}/cancel",self.connection),Some(json!({"jobId":job}))).await;
                return Err("Workspace-Abfrage abgebrochen.".into());
            }
        };
        Ok(QueryResult {
            columns: value["columns"]
                .as_array()
                .ok_or("Ergebnisspalten fehlen")?
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
            rows: value["rows"]
                .as_array()
                .ok_or("Ergebniszeilen fehlen")?
                .clone(),
            rows_affected: value["rows_affected"].as_u64(),
            execution_time_ms: value["execution_time_ms"].as_u64().unwrap_or_default(),
            truncated: value["truncated"].as_bool().unwrap_or(false),
        })
    }
}
