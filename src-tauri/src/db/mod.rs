mod cassandra;
mod clickhouse;
pub mod commands;
mod connection;
#[cfg(feature = "duckdb")]
mod duckdb;
pub mod export;
mod mongodb;
mod mssql;
mod mysql;
#[cfg(feature = "odbc")]
mod odbc;
mod oracle;
pub mod pool;
mod postgres;
pub mod provider;
mod redis;
pub mod secrets;
pub mod server_output;
mod sqlite;
pub mod ssh;
pub mod transaction;

use async_trait::async_trait;
use pool::PoolState;
pub use provider::DatabaseKind;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum SslMode {
    Disable,
    #[default]
    Prefer,
    Require,
    #[serde(rename = "verify-ca")]
    VerifyCa,
    #[serde(rename = "verify-full")]
    VerifyFull,
}

impl SslMode {
    pub fn as_url_param(&self) -> &'static str {
        match self {
            SslMode::Disable => "disable",
            SslMode::Prefer => "prefer",
            SslMode::Require => "require",
            SslMode::VerifyCa => "verify-ca",
            SslMode::VerifyFull => "verify-full",
        }
    }

    pub fn to_pg(self) -> tokio_postgres::config::SslMode {
        match self {
            SslMode::Disable => tokio_postgres::config::SslMode::Disable,
            SslMode::Prefer => tokio_postgres::config::SslMode::Prefer,
            SslMode::Require => tokio_postgres::config::SslMode::Require,
            SslMode::VerifyCa => tokio_postgres::config::SslMode::Require,
            SslMode::VerifyFull => tokio_postgres::config::SslMode::Require,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionConfig {
    pub kind: DatabaseKind,
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
    #[serde(default)]
    pub ssl_mode: Option<SslMode>,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableInfo {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableData {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DetailedColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub column_default: Option<String>,
    pub is_primary_key: bool,
    pub ordinal_position: i32,
    pub character_maximum_length: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ImportColumnInfo {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub has_default: bool,
    pub is_identity: bool,
    pub is_generated: bool,
    pub ordinal_position: i32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CsvImportRequest {
    pub schema: String,
    pub table: String,
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Option<String>>>,
}

#[derive(Debug, Clone, Serialize)]
pub struct CsvImportOutcome {
    pub inserted_rows: u64,
    pub failed_row: Option<u32>,
    pub failed_column: Option<String>,
    pub error: Option<String>,
}

pub const CSV_IMPORT_MAX_ROWS: usize = 10_000;

#[derive(Debug, Clone, Deserialize)]
pub struct AddColumnRequest {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlterColumnRequest {
    pub old_name: String,
    pub new_name: Option<String>,
    pub data_type: Option<String>,
    pub set_not_null: Option<bool>,
    pub new_default: Option<String>,
    pub drop_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnInfo {
    pub schema: String,
    pub table: String,
    pub name: String,
    pub data_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnMatch {
    pub schema: String,
    pub table: String,
    pub column: String,
    pub data_type: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SourceMatch {
    pub schema: String,
    pub name: String,
    pub oid: String,
    pub identity: String,
    pub object_type: String,
    pub line: i32,
    pub snippet: String,
    pub occurrences: i32,
}

#[derive(Debug, Clone, Serialize)]
pub struct DependencyInfo {
    pub owner: String,
    pub name: String,
    pub object_type: String,
    pub status: String,
    pub relation: String,
    pub oid: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SynonymInfo {
    pub owner: String,
    pub name: String,
    pub target_owner: String,
    pub target_name: String,
    pub target_type: String,
    pub db_link: Option<String>,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchedulerJobInfo {
    pub id: String,
    pub owner: String,
    pub name: String,
    pub enabled: bool,
    pub state: String,
    pub schedule: String,
    pub command: String,
    pub last_run: Option<String>,
    pub last_status: Option<String>,
    pub last_error: Option<String>,
    pub next_run: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ForeignKeyInfo {
    pub constraint_name: String,
    pub from_schema: String,
    pub from_table: String,
    pub from_column: String,
    pub to_schema: String,
    pub to_table: String,
    pub to_column: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<serde_json::Value>,
    pub rows_affected: Option<u64>,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FunctionInfo {
    pub schema: String,
    pub name: String,
    pub identity_args: String,
    pub return_type: String,
    pub language: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompileResult {
    pub status: String,
    pub message: Option<String>,
    pub line: Option<i32>,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvalidObjectInfo {
    pub schema: String,
    pub name: String,
    pub object_type: String,
    pub status: String,
    pub oid: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct CompileErrorInfo {
    pub schema: String,
    pub name: String,
    pub object_type: String,
    pub line: Option<i32>,
    pub position: Option<i32>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct InvalidCompileOutcome {
    pub schema: String,
    pub name: String,
    pub object_type: String,
    pub oid: String,
    pub status: String,
    pub message: Option<String>,
    pub line: Option<i32>,
    pub position: Option<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct DebugSessionInfo {
    pub available: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ExtensionInfo {
    pub name: String,
    pub version: Option<String>,
    pub schema: Option<String>,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoleInfo {
    pub name: String,
    pub oid: String,
    pub superuser: bool,
    pub can_login: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: i32,
    pub valid_until: Option<String>,
    pub member_of: Vec<String>,
    pub members: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateRoleOptions {
    pub name: String,
    pub password: Option<String>,
    pub superuser: bool,
    pub can_login: bool,
    pub create_db: bool,
    pub create_role: bool,
    pub replication: bool,
    pub bypass_rls: bool,
    pub conn_limit: Option<i32>,
    pub valid_until: Option<String>,
    pub member_of: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlterRoleOptions {
    pub name: String,
    pub password: Option<String>,
    pub superuser: Option<bool>,
    pub can_login: Option<bool>,
    pub create_db: Option<bool>,
    pub create_role: Option<bool>,
    pub replication: Option<bool>,
    pub bypass_rls: Option<bool>,
    pub conn_limit: Option<i32>,
    pub valid_until: Option<String>,
    pub clear_valid_until: bool,
    pub grant_roles: Vec<String>,
    pub revoke_roles: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TablePrivileges {
    pub schema: String,
    pub table: String,
    pub object_type: String,
    pub select: bool,
    pub insert: bool,
    pub update: bool,
    pub delete: bool,
    pub truncate: bool,
    pub references: bool,
    pub trigger: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaPrivileges {
    pub schema: String,
    pub usage: bool,
    pub create: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct RolePrivileges {
    pub schemas: Vec<SchemaPrivileges>,
    pub tables: Vec<TablePrivileges>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PrivilegeChange {
    pub grant: bool,
    pub privilege: String,
    pub object_type: String,
    pub schema: Option<String>,
    pub table: Option<String>,
    pub role_name: String,
}

#[async_trait]
pub trait TxSession: Send {
    async fn execute(&mut self, sql: &str) -> Result<QueryResult, String>;
    async fn commit(&mut self) -> Result<(), String>;
    async fn rollback(&mut self) -> Result<(), String>;
}

#[async_trait]
pub trait DatabaseAdapter: Send + Sync {
    async fn begin_transaction(&self) -> Result<Box<dyn TxSession>, String> {
        Err(unsupported("Transaktionen"))
    }
    async fn test_connection(&self) -> Result<(), String>;
    async fn list_databases(&self) -> Result<Vec<String>, String>;
    async fn list_schemas(&self) -> Result<Vec<String>, String>;
    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String>;
    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String>;
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
        allow_raw_filter: bool,
    ) -> Result<TableData, String>;
    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        allow_raw_filter: bool,
    ) -> Result<i64, String>;
    async fn update_row(
        &self,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &std::collections::HashMap<String, Option<String>>,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = ctid;
        let _ = updates;
        Err(unsupported("Direkte Zeilenänderung"))
    }
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;
    async fn execute_query_with_params(
        &self,
        sql: &str,
        params: &[Option<String>],
    ) -> Result<QueryResult, String> {
        let _ = sql;
        let _ = params;
        Err(unsupported("Bind-Parameter"))
    }
    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let _ = schema;
        Err(unsupported("Views"))
    }
    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let _ = schema;
        let _ = view;
        Err(unsupported("View-Definitionen"))
    }
    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = view;
        let _ = body;
        let _ = dry_run;
        Err(unsupported("View-Bearbeitung"))
    }
    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let _ = schema;
        Err(unsupported("Funktionen"))
    }
    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let _ = oid;
        Err(unsupported("Funktionsdefinitionen"))
    }
    async fn list_procedures(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let _ = schema;
        Err(unsupported("Prozeduren"))
    }
    async fn compile_object(&self, oid: &str, object_type: &str) -> Result<CompileResult, String> {
        let _ = (oid, object_type);
        Err(unsupported("Objekte kompilieren"))
    }
    async fn list_invalid_objects(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<InvalidObjectInfo>, String> {
        let _ = schema;
        Err(unsupported("Invalide Objekte"))
    }
    async fn list_compile_errors(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<CompileErrorInfo>, String> {
        let _ = schema;
        Err(unsupported("Kompilierfehler"))
    }
    async fn compile_invalid_objects(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<InvalidCompileOutcome>, String> {
        let _ = schema;
        Err(unsupported("Invalide Objekte kompilieren"))
    }
    async fn start_debug_session(
        &self,
        oid: &str,
        object_type: &str,
    ) -> Result<DebugSessionInfo, String> {
        let _ = (oid, object_type);
        Err(unsupported("PL/SQL-Debugger"))
    }
    async fn search_columns(
        &self,
        schema: Option<&str>,
        term: &str,
        limit: i64,
    ) -> Result<Vec<ColumnMatch>, String> {
        let _ = (schema, term, limit);
        Err(unsupported("Spaltensuche"))
    }
    async fn search_source(
        &self,
        schema: Option<&str>,
        term: &str,
        limit: i64,
    ) -> Result<Vec<SourceMatch>, String> {
        let _ = (schema, term, limit);
        Err(unsupported("Quelltextsuche"))
    }
    async fn list_used_by(&self, schema: &str, name: &str) -> Result<Vec<DependencyInfo>, String> {
        let _ = (schema, name);
        Err(unsupported("Verwendungsnachweis"))
    }
    async fn list_synonyms(&self, schema: Option<&str>) -> Result<Vec<SynonymInfo>, String> {
        let _ = schema;
        Err(unsupported("Synonyme"))
    }
    async fn list_scheduler_jobs(&self) -> Result<Vec<SchedulerJobInfo>, String> {
        Err(unsupported("Scheduler-Jobs"))
    }
    async fn set_scheduler_job_enabled(&self, job_id: &str, enabled: bool) -> Result<(), String> {
        let _ = (job_id, enabled);
        Err(unsupported("Scheduler-Jobs"))
    }
    async fn run_scheduler_job(&self, job_id: &str) -> Result<(), String> {
        let _ = job_id;
        Err(unsupported("Scheduler-Jobs"))
    }
    async fn list_extensions(&self) -> Result<Vec<ExtensionInfo>, String> {
        Err(unsupported("Extensions"))
    }
    async fn list_roles(&self) -> Result<Vec<RoleInfo>, String> {
        Err(unsupported("Rollen"))
    }
    async fn create_role(&self, options: &CreateRoleOptions) -> Result<(), String> {
        let _ = options;
        Err(unsupported("Rollenverwaltung"))
    }
    async fn alter_role(&self, options: &AlterRoleOptions) -> Result<(), String> {
        let _ = options;
        Err(unsupported("Rollenverwaltung"))
    }
    async fn drop_role(&self, name: &str) -> Result<(), String> {
        let _ = name;
        Err(unsupported("Rollenverwaltung"))
    }
    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("DROP TABLE"))
    }
    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("TRUNCATE"))
    }
    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Spaltendetails"))
    }
    async fn list_import_columns(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ImportColumnInfo>, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("CSV-Import"))
    }
    async fn csv_import(&self, request: &CsvImportRequest) -> Result<CsvImportOutcome, String> {
        let _ = request;
        Err(unsupported("CSV-Import"))
    }
    async fn export_table_csv(
        &self,
        request: &export::TableExportRequest,
        progress: &(dyn Fn(i64) + Send + Sync),
    ) -> Result<export::TableExportOutcome, String> {
        let _ = request;
        let _ = progress;
        Err(unsupported("Vollständiger Tabellenexport"))
    }
    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = column;
        Err(unsupported("Spalten hinzufügen"))
    }
    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = changes;
        Err(unsupported("Spalten ändern"))
    }
    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = column;
        Err(unsupported("Spalten löschen"))
    }
    async fn list_role_privileges(&self, role_name: &str) -> Result<RolePrivileges, String> {
        let _ = role_name;
        Err(unsupported("Berechtigungen"))
    }
    async fn modify_privilege(&self, change: &PrivilegeChange) -> Result<(), String> {
        let _ = change;
        Err(unsupported("Berechtigungen"))
    }
    async fn validate_sql(&self, sql: &str) -> Result<(), String> {
        let _ = sql;
        Err(unsupported(
            "Prüfen ohne Speichern (kein transaktionales DDL)",
        ))
    }
    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Fremdschlüssel"))
    }
    async fn get_er_schema(&self, schema: Option<&str>) -> Result<ERSchema, String> {
        let mut tables = Vec::new();
        let mut foreign_keys = Vec::new();
        for table in self.list_tables(schema).await? {
            let columns = self
                .list_table_columns_detailed(&table.schema, &table.name)
                .await?
                .into_iter()
                .map(|c| ERColumn {
                    name: c.name,
                    data_type: c.data_type,
                    is_primary_key: c.is_primary_key,
                    is_nullable: c.is_nullable,
                })
                .collect();
            if let Ok(fks) = self.list_foreign_keys(&table.schema, &table.name).await {
                foreign_keys.extend(fks);
            }
            tables.push(ERTable {
                schema: table.schema,
                name: table.name,
                columns,
            });
        }
        Ok(ERSchema {
            tables,
            foreign_keys,
        })
    }
    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Trigger"))
    }
    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String> {
        let _ = schema;
        Err(unsupported("Sequenzen"))
    }
    async fn alter_sequence(
        &self,
        schema: &str,
        name: &str,
        changes: &AlterSequenceRequest,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = name;
        let _ = changes;
        Err(unsupported("Sequenzen"))
    }
    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Indizes"))
    }
    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Constraints"))
    }
    async fn install_extension(&self, name: &str, schema: Option<&str>) -> Result<(), String> {
        let _ = name;
        let _ = schema;
        Err(unsupported("Extensions"))
    }
    async fn uninstall_extension(&self, name: &str) -> Result<(), String> {
        let _ = name;
        Err(unsupported("Extensions"))
    }
    async fn list_available_extensions(&self) -> Result<Vec<AvailableExtensionInfo>, String> {
        Err(unsupported("Extensions"))
    }
    async fn execute_script(&self, sql: &str) -> Result<Vec<ScriptStatementResult>, String> {
        let mut results = Vec::new();
        for statement in split_statements(sql) {
            let result = self.execute_query(&statement).await;
            results.push(ScriptStatementResult {
                statement: statement.clone(),
                success: result.is_ok(),
                rows_affected: result.as_ref().ok().and_then(|r| r.rows_affected),
                error: result.err(),
            });
        }
        Ok(results)
    }
    async fn set_server_output(&self, enabled: bool) -> Result<(), String> {
        let _ = enabled;
        Err(unsupported("Server-Ausgabe"))
    }
    async fn take_server_output(&self) -> Result<Vec<server_output::ServerMessage>, String> {
        Err(unsupported("Server-Ausgabe"))
    }
    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String> {
        let _ = req;
        Err(unsupported("CREATE TABLE"))
    }
    async fn preview_create_table_ddl(&self, req: &CreateTableRequest) -> Result<String, String> {
        let _ = req;
        Err(unsupported("CREATE TABLE Vorschau"))
    }
    async fn preview_object_ddl(&self, req: &ObjectDdlRequest) -> Result<String, String> {
        let _ = req;
        Err(unsupported("Objekt-DDL-Vorschau"))
    }
    async fn execute_object_ddl(&self, req: &ObjectDdlRequest) -> Result<(), String> {
        let _ = req;
        Err(unsupported("Objektverwaltung"))
    }
    async fn object_audit_info(
        &self,
        schema: &str,
        name: &str,
        object_type: &str,
    ) -> Result<ObjectAuditInfo, String> {
        let _ = schema;
        let _ = name;
        let _ = object_type;
        Err(unsupported("Objekt-Audit"))
    }
    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let _ = sql;
        let _ = analyze;
        Err(unsupported("EXPLAIN"))
    }
    async fn list_materialized_views(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<MatviewInfo>, String> {
        let _ = schema;
        Err(unsupported("Materialized Views"))
    }
    async fn refresh_materialized_view(
        &self,
        schema: &str,
        name: &str,
        concurrently: bool,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = name;
        let _ = concurrently;
        Err(unsupported("Materialized Views"))
    }
    async fn drop_materialized_view(&self, schema: &str, name: &str) -> Result<(), String> {
        let _ = schema;
        let _ = name;
        Err(unsupported("Materialized Views"))
    }
    async fn create_materialized_view(&self, req: &CreateMatviewRequest) -> Result<(), String> {
        let _ = req;
        Err(unsupported("Materialized Views"))
    }
    async fn get_table_rls(&self, schema: &str, table: &str) -> Result<TableRlsInfo, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Row Level Security"))
    }
    async fn set_table_rls(
        &self,
        schema: &str,
        table: &str,
        enabled: bool,
        force: bool,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = enabled;
        let _ = force;
        Err(unsupported("Row Level Security"))
    }
    async fn create_policy(
        &self,
        schema: &str,
        table: &str,
        policy: &CreatePolicyRequest,
    ) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = policy;
        Err(unsupported("Row Level Security"))
    }
    async fn drop_policy(&self, schema: &str, table: &str, name: &str) -> Result<(), String> {
        let _ = schema;
        let _ = table;
        let _ = name;
        Err(unsupported("Row Level Security"))
    }
    async fn get_partition_info(&self, schema: &str, table: &str) -> Result<PartitionInfo, String> {
        let _ = schema;
        let _ = table;
        Err(unsupported("Partitionen"))
    }
    async fn detach_partition(
        &self,
        parent_schema: &str,
        parent_table: &str,
        child_schema: &str,
        child_table: &str,
    ) -> Result<(), String> {
        let _ = parent_schema;
        let _ = parent_table;
        let _ = child_schema;
        let _ = child_table;
        Err(unsupported("Partitionen"))
    }
    async fn attach_partition(
        &self,
        parent_schema: &str,
        parent_table: &str,
        child_schema: &str,
        child_table: &str,
        bound: &str,
    ) -> Result<(), String> {
        let _ = parent_schema;
        let _ = parent_table;
        let _ = child_schema;
        let _ = child_table;
        let _ = bound;
        Err(unsupported("Partitionen"))
    }
    async fn list_publications(&self) -> Result<Vec<PublicationInfo>, String> {
        Err(unsupported("Replikation"))
    }
    async fn create_publication(&self, req: &CreatePublicationRequest) -> Result<(), String> {
        let _ = req;
        Err(unsupported("Replikation"))
    }
    async fn drop_publication(&self, name: &str) -> Result<(), String> {
        let _ = name;
        Err(unsupported("Replikation"))
    }
    async fn list_subscriptions(&self) -> Result<Vec<SubscriptionInfo>, String> {
        Err(unsupported("Replikation"))
    }
    async fn create_subscription(&self, req: &CreateSubscriptionRequest) -> Result<(), String> {
        let _ = req;
        Err(unsupported("Replikation"))
    }
    async fn drop_subscription(&self, name: &str) -> Result<(), String> {
        let _ = name;
        Err(unsupported("Replikation"))
    }
    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        Err(unsupported("Sitzungen"))
    }
    async fn cancel_session(&self, pid: i32) -> Result<bool, String> {
        let _ = pid;
        Err(unsupported("Sitzungen"))
    }
    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        let _ = pid;
        Err(unsupported("Sitzungen"))
    }
    async fn list_locks(&self) -> Result<Vec<LockInfo>, String> {
        Err(unsupported("Sperren"))
    }
    async fn list_enums(&self, schema: Option<&str>) -> Result<Vec<EnumInfo>, String> {
        let _ = schema;
        Err(unsupported("Enums"))
    }
    async fn create_schema(&self, name: &str) -> Result<(), String> {
        let _ = name;
        Err(unsupported("Schema anlegen"))
    }
    async fn drop_schema(&self, name: &str, cascade: bool) -> Result<(), String> {
        let _ = name;
        let _ = cascade;
        Err(unsupported("Schema löschen"))
    }
    async fn get_database_overview(&self) -> Result<DatabaseOverview, String> {
        Err(unsupported("Datenbankübersicht"))
    }
    async fn list_schema_copy_objects(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
    ) -> Result<Vec<SchemaObjectEntry>, String> {
        let _ = source_schema;
        let _ = target_schema;
        let _ = object_type;
        Err(unsupported("Schema-Kopie"))
    }
    async fn preview_schema_object_copy(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
        name: &str,
    ) -> Result<String, String> {
        let _ = source_schema;
        let _ = target_schema;
        let _ = object_type;
        let _ = name;
        Err(unsupported("Schema-Kopie"))
    }
    async fn execute_schema_object_copy(
        &self,
        source_schema: &str,
        target_schema: &str,
        object_type: &str,
        name: &str,
    ) -> Result<String, String> {
        let _ = source_schema;
        let _ = target_schema;
        let _ = object_type;
        let _ = name;
        Err(unsupported("Schema-Kopie"))
    }
    async fn copy_schema_table_data(
        &self,
        source_schema: &str,
        target_schema: &str,
        name: &str,
        limit: i64,
    ) -> Result<u64, String> {
        let _ = source_schema;
        let _ = target_schema;
        let _ = name;
        let _ = limit;
        Err(unsupported("Schema-Kopie"))
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaObjectEntry {
    pub name: String,
    pub object_type: String,
    pub status: String,
    pub source_definition: String,
    pub target_definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct TriggerInfo {
    pub trigger_name: String,
    pub table_schema: String,
    pub table_name: String,
    pub event: String,
    pub timing: String,
    pub orientation: String,
    pub function_schema: String,
    pub function_name: String,
    pub enabled: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SequenceInfo {
    pub schema: String,
    pub name: String,
    pub data_type: String,
    pub start_value: String,
    pub min_value: String,
    pub max_value: String,
    pub increment_by: String,
    pub cycle: bool,
    pub last_value: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ERColumn {
    pub name: String,
    pub data_type: String,
    pub is_primary_key: bool,
    pub is_nullable: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ERTable {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ERColumn>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ERSchema {
    pub tables: Vec<ERTable>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexInfo {
    pub name: String,
    pub is_unique: bool,
    pub is_primary: bool,
    pub columns: Vec<String>,
    pub index_type: String,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ConstraintInfo {
    pub name: String,
    pub constraint_type: String,
    pub columns: Vec<String>,
    pub definition: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct ScriptStatementResult {
    pub statement: String,
    pub success: bool,
    pub rows_affected: Option<u64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ColumnDefinition {
    pub name: String,
    pub data_type: String,
    pub is_nullable: bool,
    pub default_value: Option<String>,
    pub is_primary_key: bool,
    pub is_unique: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObjectDdlRequest {
    pub schema: String,
    pub name: String,
    pub object_type: String,
    pub action: String,
    #[serde(default)]
    pub cascade: bool,
    #[serde(default)]
    pub new_name: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectDependent {
    pub schema: String,
    pub name: String,
    pub object_type: String,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ObjectAuditInfo {
    pub schema: String,
    pub name: String,
    pub object_type: String,
    pub owner: Option<String>,
    pub size: Option<String>,
    pub row_estimate: Option<i64>,
    pub created_at: Option<String>,
    pub changed_at: Option<String>,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub last_analyze: Option<String>,
    pub last_autoanalyze: Option<String>,
    pub dependents: Vec<ObjectDependent>,
    pub notes: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateTableRequest {
    pub schema: String,
    pub name: String,
    pub columns: Vec<ColumnDefinition>,
    pub if_not_exists: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct AlterSequenceRequest {
    pub increment_by: Option<String>,
    pub min_value: Option<String>,
    pub max_value: Option<String>,
    pub cycle: Option<bool>,
    pub restart_with: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AvailableExtensionInfo {
    pub name: String,
    pub default_version: String,
    pub comment: Option<String>,
    pub installed: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct MatviewInfo {
    pub schema: String,
    pub name: String,
    pub is_populated: bool,
    pub definition: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateMatviewRequest {
    pub schema: String,
    pub name: String,
    pub query: String,
    pub with_data: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct PolicyInfo {
    pub name: String,
    pub command: String,
    pub roles: Vec<String>,
    pub using_expr: Option<String>,
    pub check_expr: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct TableRlsInfo {
    pub rls_enabled: bool,
    pub force_rls: bool,
    pub policies: Vec<PolicyInfo>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreatePolicyRequest {
    pub name: String,
    pub command: String,
    pub roles: Vec<String>,
    pub using_expr: Option<String>,
    pub check_expr: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PartitionChild {
    pub schema: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct PublicationInfo {
    pub name: String,
    pub owner: String,
    pub all_tables: bool,
    pub insert: bool,
    pub update: bool,
    pub delete: bool,
    pub truncate: bool,
    pub tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicationTable {
    pub schema: String,
    pub table: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreatePublicationRequest {
    pub name: String,
    pub for_all_tables: bool,
    pub tables: Vec<PublicationTable>,
    pub publish_insert: bool,
    pub publish_update: bool,
    pub publish_delete: bool,
    pub publish_truncate: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SubscriptionInfo {
    pub name: String,
    pub enabled: bool,
    pub connection_string: String,
    pub slot_name: Option<String>,
    pub publications: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateSubscriptionRequest {
    pub name: String,
    pub connection_string: String,
    pub publications: Vec<String>,
    pub slot_name: Option<String>,
    pub enabled: bool,
    pub connect: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionInfo {
    pub pid: i32,
    pub user: String,
    pub database: String,
    pub application: String,
    pub client_addr: Option<String>,
    pub state: Option<String>,
    pub query: String,
    pub query_start: Option<String>,
    pub transaction_start: Option<String>,
    pub wait_event: Option<String>,
    pub is_self: bool,
    pub blocked_by: Vec<i32>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LockInfo {
    pub pid: i32,
    pub lock_type: String,
    pub relation: Option<String>,
    pub mode: String,
    pub granted: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EnumInfo {
    pub schema: String,
    pub name: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SchemaSize {
    pub schema: String,
    pub table_count: i64,
    pub size_bytes: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct DatabaseOverview {
    pub database: String,
    pub size_bytes: i64,
    pub size_pretty: String,
    pub schemas: Vec<SchemaSize>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PartitionInfo {
    pub is_partitioned: bool,
    pub strategy: Option<String>,
    pub partition_key: Option<String>,
    pub partitions: Vec<PartitionChild>,
}

pub(crate) fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub(crate) fn quote_literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

pub(crate) fn map_pg_err(e: tokio_postgres::Error) -> String {
    if let Some(db_err) = e.as_db_error() {
        let mut msg = format!("{}: {}", db_err.severity(), db_err.message());
        if let Some(detail) = db_err.detail() {
            msg.push_str(&format!("\nDetail: {detail}"));
        }
        if let Some(hint) = db_err.hint() {
            msg.push_str(&format!("\nHinweis: {hint}"));
        }
        if let Some(pos) = db_err.position() {
            msg.push_str(&format!("\nPosition: {pos:?}"));
        }
        msg
    } else {
        format!("Datenbankfehler: {e}")
    }
}

pub fn unsupported(feature: &str) -> String {
    format!("{feature} wird von diesem Datenbanktyp nicht unterstützt.")
}

pub(crate) fn split_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut escaped = false;
    for ch in sql.chars() {
        match quote {
            Some(q) => {
                current.push(ch);
                if escaped {
                    escaped = false;
                } else if ch == '\\' && q != '`' {
                    escaped = true;
                } else if ch == q {
                    quote = None;
                }
            }
            None if ch == '\'' || ch == '"' || ch == '`' => {
                quote = Some(ch);
                current.push(ch);
            }
            None if ch == ';' => {
                if !current.trim().is_empty() {
                    statements.push(current.trim().to_string());
                }
                current.clear();
            }
            None => current.push(ch),
        }
    }
    if !current.trim().is_empty() {
        statements.push(current.trim().to_string());
    }
    statements
}

pub(crate) fn row_key(row: &serde_json::Value, pk: &[String]) -> Option<String> {
    let obj = row.as_object()?;
    if pk.is_empty() {
        return None;
    }
    let mut key = serde_json::Map::new();
    for col in pk {
        key.insert(col.clone(), obj.get(col)?.clone());
    }
    Some(serde_json::Value::Object(key).to_string())
}

pub(crate) fn attach_row_keys(rows: &mut [serde_json::Value], pk: &[String]) {
    for row in rows.iter_mut() {
        if let Some(key) = row_key(row, pk) {
            if let Some(obj) = row.as_object_mut() {
                obj.insert("__ctid__".to_string(), serde_json::Value::String(key));
            }
        }
    }
}

pub(crate) fn rows_to_objects(
    columns: &[String],
    rows: Vec<Vec<serde_json::Value>>,
) -> Vec<serde_json::Value> {
    rows.into_iter()
        .map(|values| {
            let mut object = serde_json::Map::with_capacity(columns.len());
            for (column, value) in columns.iter().zip(values) {
                object.insert(column.clone(), value);
            }
            serde_json::Value::Object(object)
        })
        .collect()
}

pub(crate) async fn timed<T, F>(future: F) -> Result<T, String>
where
    F: std::future::Future<Output = Result<T, String>>,
{
    tokio::time::timeout(std::time::Duration::from_secs(30), future)
        .await
        .map_err(|_| "Query-Timeout: Die Abfrage hat länger als 30 Sekunden gedauert".to_string())?
}

pub(crate) fn create_table_sql(
    req: &CreateTableRequest,
    quote: fn(&str) -> String,
    qualify_schema: bool,
) -> String {
    let mut parts: Vec<String> = Vec::new();
    let mut pk_cols: Vec<String> = Vec::new();
    for col in &req.columns {
        let mut def = format!("{} {}", quote(&col.name), col.data_type);
        if let Some(d) = col.default_value.as_deref().filter(|d| !d.is_empty()) {
            def.push_str(&format!(" DEFAULT {d}"));
        }
        if !col.is_nullable {
            def.push_str(" NOT NULL");
        }
        if col.is_unique && !col.is_primary_key {
            def.push_str(" UNIQUE");
        }
        parts.push(def);
        if col.is_primary_key {
            pk_cols.push(quote(&col.name));
        }
    }
    if !pk_cols.is_empty() {
        parts.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
    }
    let target = if qualify_schema && !req.schema.is_empty() {
        format!("{}.{}", quote(&req.schema), quote(&req.name))
    } else {
        quote(&req.name)
    };
    format!(
        "CREATE TABLE {}{} (\n  {}\n)",
        if req.if_not_exists {
            "IF NOT EXISTS "
        } else {
            ""
        },
        target,
        parts.join(",\n  "),
    )
}

fn schema_qualifier_boundary(sql: &str, idx: usize) -> bool {
    !sql[..idx]
        .chars()
        .next_back()
        .is_some_and(|c| c.is_alphanumeric() || c == '_' || c == '"' || c == '.' || c == '$')
}

pub(crate) fn requalify_schema(sql: &str, from_schema: &str, to_schema: &str) -> String {
    if from_schema.is_empty() || from_schema == to_schema {
        return sql.to_string();
    }
    let quoted_from = format!("\"{from_schema}\".");
    let quoted_to = format!("\"{to_schema}\".");
    let bare_from = format!("{from_schema}.");
    let bare_to = format!("\"{to_schema}\".");
    let mut out = String::with_capacity(sql.len());
    let mut idx = 0usize;
    while idx < sql.len() {
        let rest = &sql[idx..];
        if rest.starts_with(&quoted_from) {
            out.push_str(&quoted_to);
            idx += quoted_from.len();
            continue;
        }
        if rest.starts_with(&bare_from) && schema_qualifier_boundary(sql, idx) {
            out.push_str(&bare_to);
            idx += bare_from.len();
            continue;
        }
        let ch = rest.chars().next().unwrap_or('\0');
        out.push(ch);
        idx += ch.len_utf8();
    }
    out
}

pub(crate) fn pretty_bytes(bytes: i64) -> String {
    let units = ["B", "kB", "MB", "GB", "TB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < units.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{bytes} B")
    } else {
        format!("{value:.1} {}", units[unit])
    }
}

pub(crate) fn hex_blob(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(2 + bytes.len() * 2);
    out.push_str("\\x");
    const HEX: &[u8; 16] = b"0123456789abcdef";
    for b in bytes {
        out.push(HEX[(b >> 4) as usize] as char);
        out.push(HEX[(b & 0x0f) as usize] as char);
    }
    out
}

pub(crate) fn where_clause(filter: Option<&str>, allow_raw: bool) -> Result<String, String> {
    match filter.map(str::trim).filter(|f| !f.is_empty()) {
        Some(expression) => {
            if !allow_raw {
                validate_table_filter(expression)?;
            }
            Ok(format!(" WHERE {expression}"))
        }
        None => Ok(String::new()),
    }
}

pub fn create_adapter(
    config: ConnectionConfig,
    pool_state: PoolState,
) -> Result<Box<dyn DatabaseAdapter>, String> {
    match config.kind {
        DatabaseKind::Postgres => Ok(Box::new(postgres::PostgresAdapter::from_config(
            config, pool_state,
        ))),
        kind => {
            let scheme = kind.url_schemes()[0];
            let url = format!(
                "{scheme}://{}:{}@{}:{}/{}",
                url::form_urlencoded::byte_serialize(config.user.as_bytes()).collect::<String>(),
                url::form_urlencoded::byte_serialize(config.password.as_bytes())
                    .collect::<String>(),
                config.host,
                config.port,
                config.database
            );
            create_adapter_from_string(kind, &url, None, pool_state)
        }
    }
}

pub fn create_adapter_from_string(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool_state: PoolState,
) -> Result<Box<dyn DatabaseAdapter>, String> {
    let database = database.filter(|db| !db.is_empty());
    let key = connection::connection_key(connection_string, database);
    Ok(match kind {
        DatabaseKind::Postgres => Box::new(postgres::PostgresAdapter::from_connection_string(
            connection_string,
            database,
            pool_state,
        )?),
        DatabaseKind::Mysql => Box::new(mysql::MysqlAdapter::new(
            connection_string,
            database,
            pool_state,
            key,
        )?),
        DatabaseKind::Sqlite => Box::new(sqlite::SqliteAdapter::new(
            connection_string,
            pool_state,
            key,
        )?),
        DatabaseKind::Mssql => Box::new(mssql::MssqlAdapter::new(
            connection_string,
            database,
            pool_state,
            key,
        )?),
        DatabaseKind::Clickhouse => Box::new(clickhouse::ClickhouseAdapter::new(
            connection_string,
            database,
        )?),
        DatabaseKind::Mongodb => Box::new(mongodb::MongoAdapter::new(
            connection_string,
            database,
            pool_state,
            key,
        )?),
        DatabaseKind::Redis => Box::new(redis::RedisAdapter::new(
            connection_string,
            database,
            pool_state,
            key,
        )?),
        DatabaseKind::Oracle => Box::new(oracle::OracleAdapter::new(
            connection_string,
            pool_state,
            key,
        )?),
        DatabaseKind::Cassandra => Box::new(cassandra::CassandraAdapter::new(
            connection_string,
            pool_state,
            key,
        )?),
        #[cfg(feature = "duckdb")]
        DatabaseKind::Duckdb => Box::new(duckdb::DuckdbAdapter::new(
            connection_string,
            pool_state,
            key,
        )?),
        #[cfg(not(feature = "duckdb"))]
        DatabaseKind::Duckdb => return Err(provider::kind_driver_status(kind).detail),
        #[cfg(feature = "odbc")]
        DatabaseKind::Odbc => Box::new(odbc::OdbcAdapter::new(connection_string, pool_state, key)?),
        #[cfg(not(feature = "odbc"))]
        DatabaseKind::Odbc => return Err(provider::kind_driver_status(kind).detail),
    })
}

pub fn validate_object_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Der neue Name darf nicht leer sein.".to_string());
    }
    if trimmed.chars().count() > 63 {
        return Err("Der neue Name darf höchstens 63 Zeichen lang sein.".to_string());
    }
    if trimmed.contains('"') {
        return Err("Der neue Name darf keine Anführungszeichen enthalten.".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Der neue Name darf keine Steuerzeichen enthalten.".to_string());
    }
    Ok(trimmed.to_string())
}

fn object_keyword(object_type: &str) -> Result<&'static str, String> {
    match object_type {
        "table" => Ok("TABLE"),
        "view" => Ok("VIEW"),
        "materialized_view" => Ok("MATERIALIZED VIEW"),
        other => Err(format!("Unbekannter Objekttyp: {other}")),
    }
}

pub fn build_object_ddl(req: &ObjectDdlRequest) -> Result<String, String> {
    let keyword = object_keyword(req.object_type.as_str())?;
    let qualified = format!("{}.{}", quote_ident(&req.schema), quote_ident(&req.name));
    match req.action.as_str() {
        "drop" => {
            let suffix = if req.cascade { "CASCADE" } else { "RESTRICT" };
            Ok(format!("DROP {keyword} {qualified} {suffix};"))
        }
        "rename" => {
            let new_name = req
                .new_name
                .as_deref()
                .ok_or_else(|| "Kein neuer Name angegeben.".to_string())?;
            let validated = validate_object_name(new_name)?;
            if validated == req.name {
                return Err("Der neue Name entspricht dem bisherigen Namen.".to_string());
            }
            Ok(format!(
                "ALTER {keyword} {qualified} RENAME TO {};",
                quote_ident(&validated)
            ))
        }
        other => Err(format!("Unbekannte Aktion: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::{redact_connection_string, split_statements, validate_table_filter};

    use super::{build_object_ddl, hex_blob, validate_object_name, ObjectDdlRequest};

    #[test]
    fn hex_blob_encodes_bytes() {
        assert_eq!(hex_blob(&[]), "\\x");
        assert_eq!(hex_blob(&[0x00, 0x0f, 0xa5, 0xff]), "\\x000fa5ff");
    }

    fn ddl_req(object_type: &str, action: &str) -> ObjectDdlRequest {
        ObjectDdlRequest {
            schema: "public".to_string(),
            name: "kunden".to_string(),
            object_type: object_type.to_string(),
            action: action.to_string(),
            cascade: false,
            new_name: None,
        }
    }

    #[test]
    fn drop_table_defaults_to_restrict() {
        let sql = build_object_ddl(&ddl_req("table", "drop")).unwrap();
        assert_eq!(sql, "DROP TABLE \"public\".\"kunden\" RESTRICT;");
    }

    #[test]
    fn drop_view_with_cascade() {
        let mut req = ddl_req("view", "drop");
        req.cascade = true;
        let sql = build_object_ddl(&req).unwrap();
        assert_eq!(sql, "DROP VIEW \"public\".\"kunden\" CASCADE;");
    }

    #[test]
    fn rename_materialized_view() {
        let mut req = ddl_req("materialized_view", "rename");
        req.new_name = Some("kunden_alt".to_string());
        let sql = build_object_ddl(&req).unwrap();
        assert_eq!(
            sql,
            "ALTER MATERIALIZED VIEW \"public\".\"kunden\" RENAME TO \"kunden_alt\";"
        );
    }

    #[test]
    fn rename_quotes_injection_attempts() {
        let mut req = ddl_req("table", "rename");
        req.new_name = Some("a\"; DROP TABLE x; --".to_string());
        assert!(build_object_ddl(&req).is_err());
    }

    #[test]
    fn rename_rejects_empty_and_same_name() {
        let mut req = ddl_req("table", "rename");
        req.new_name = Some("   ".to_string());
        assert!(build_object_ddl(&req).is_err());
        req.new_name = Some("kunden".to_string());
        assert!(build_object_ddl(&req).is_err());
    }

    #[test]
    fn unknown_action_and_type_rejected() {
        assert!(build_object_ddl(&ddl_req("table", "truncate")).is_err());
        assert!(build_object_ddl(&ddl_req("sequence", "drop")).is_err());
    }

    #[test]
    fn validate_object_name_trims() {
        assert_eq!(validate_object_name("  neu  ").unwrap(), "neu");
        assert!(validate_object_name(&"x".repeat(64)).is_err());
    }

    #[test]
    fn requalify_schema_replaces_only_qualifiers() {
        let sql = "SELECT alt.id, x.alt_id FROM alt.kunde JOIN \"alt\".\"adresse\" a ON a.id = alt.kunde.id WHERE alter_wert > 1";
        let out = super::requalify_schema(sql, "alt", "neu");
        assert!(out.contains("\"neu\".kunde"));
        assert!(out.contains("\"neu\".\"adresse\""));
        assert!(out.contains("\"neu\".id"));
        assert!(out.contains("alter_wert > 1"));
        assert!(out.contains("x.alt_id"));
        assert!(!out.contains("alt.kunde"));
        assert_eq!(super::requalify_schema(sql, "alt", "alt"), sql);
        assert_eq!(super::requalify_schema(sql, "", "neu"), sql);
    }

    fn smoke_query(kind: super::DatabaseKind) -> &'static str {
        match kind {
            super::DatabaseKind::Redis => "PING",
            super::DatabaseKind::Mongodb => "{\"ping\": 1}",
            super::DatabaseKind::Cassandra => "SELECT release_version FROM system.local",
            super::DatabaseKind::Oracle => "SELECT 1 FROM dual",
            _ => "SELECT 1",
        }
    }

    #[tokio::test]
    #[ignore]
    async fn smoke_adapters_from_env() {
        let pool = std::sync::Arc::new(super::pool::PoolManager::new());
        for kind in super::DatabaseKind::ALL {
            let var = format!("L8DB_SMOKE_{}_URL", format!("{kind:?}").to_uppercase());
            let Ok(url) = std::env::var(&var) else {
                continue;
            };
            let adapter = super::create_adapter_from_string(kind, &url, None, pool.clone())
                .unwrap_or_else(|e| panic!("{var}: {e}"));
            adapter
                .test_connection()
                .await
                .unwrap_or_else(|e| panic!("{var} connect: {e}"));
            let databases = adapter
                .list_databases()
                .await
                .unwrap_or_else(|e| panic!("{var} databases: {e}"));
            let schemas = adapter
                .list_schemas()
                .await
                .unwrap_or_else(|e| panic!("{var} schemas: {e}"));
            let schema = schemas.first().cloned();
            let tables = adapter
                .list_tables(schema.as_deref())
                .await
                .unwrap_or_else(|e| panic!("{var} tables: {e}"));
            if let Some(table) = tables.first() {
                let columns = adapter
                    .list_columns(schema.as_deref(), Some(&table.name), None)
                    .await
                    .unwrap_or_else(|e| panic!("{var} columns: {e}"));
                let rows = adapter
                    .fetch_rows(
                        &table.schema,
                        &table.name,
                        None,
                        5,
                        0,
                        None,
                        false,
                        false,
                        false,
                    )
                    .await
                    .unwrap_or_else(|e| panic!("{var} rows: {e}"));
                let count = adapter
                    .count_rows(&table.schema, &table.name, None, false)
                    .await
                    .unwrap_or_else(|e| panic!("{var} count: {e}"));
                eprintln!(
                    "{var}: table {} ({} columns, {} rows shown, {count} total)",
                    table.name,
                    columns.len(),
                    rows.rows.len()
                );
            }
            let result = adapter
                .execute_query(smoke_query(kind))
                .await
                .unwrap_or_else(|e| panic!("{var} query: {e}"));
            assert!(
                !result.columns.is_empty() || result.rows_affected.is_some(),
                "{var}: empty result"
            );
            eprintln!(
                "{var}: ok ({} databases, {} schemas, {} tables)",
                databases.len(),
                schemas.len(),
                tables.len()
            );
        }
    }

    #[test]
    fn redacts_password_keeps_user_and_host() {
        assert_eq!(
            redact_connection_string(
                "postgresql://bob:s3cret@db.internal:5432/app?sslmode=require"
            ),
            "postgresql://bob@db.internal:5432/app?sslmode=require"
        );
    }

    #[test]
    fn leaves_passwordless_strings_untouched() {
        assert_eq!(
            redact_connection_string("postgresql://bob@db.internal:5432/app"),
            "postgresql://bob@db.internal:5432/app"
        );
        assert_eq!(redact_connection_string("not-a-url"), "not-a-url");
    }

    #[test]
    fn redacts_keyword_value_passwords() {
        assert_eq!(
            redact_connection_string(
                "host=db.internal port=5432 dbname=app user=bob password=s3cret"
            ),
            "host=db.internal port=5432 dbname=app user=bob password=***"
        );
        assert_eq!(
            redact_connection_string("host=db.internal password='s3 cret' user=bob"),
            "host=db.internal password='***' user=bob"
        );
        assert_eq!(
            redact_connection_string("host=db.internal user=bob"),
            "host=db.internal user=bob"
        );
    }

    #[test]
    fn accepts_builder_generated_filters() {
        for filter in [
            "\"name\" = 'union'",
            "\"age\" > 21 AND \"city\"::text ILIKE '%münchen%'",
            "\"deleted_at\" IS NULL",
            "\"title\" <> 'a''b' AND \"n\" <= -4.5",
        ] {
            assert!(validate_table_filter(filter).is_ok(), "{filter}");
        }
    }

    #[test]
    fn splits_statements_respecting_escaped_quotes() {
        let parts = split_statements("INSERT INTO t VALUES ('O\\'Brien; x'); SELECT 1");
        assert_eq!(
            parts,
            vec!["INSERT INTO t VALUES ('O\\'Brien; x')", "SELECT 1"]
        );
    }

    #[test]
    fn splits_statements_respecting_quotes() {
        assert_eq!(
            split_statements("SELECT ';'; INSERT INTO t VALUES (\"a;b\");\n\nDELETE FROM t"),
            vec![
                "SELECT ';'",
                "INSERT INTO t VALUES (\"a;b\")",
                "DELETE FROM t"
            ]
        );
    }

    #[test]
    fn rejects_smuggled_statements() {
        for filter in [
            "1=1; DROP TABLE users",
            "1=1 -- Kommentar",
            "1=1 /* Kommentar */",
            "1=2 UNION SELECT usename FROM pg_shadow",
            "1=1 returning *",
            "x INTO outfile '/tmp/x'",
        ] {
            assert!(validate_table_filter(filter).is_err(), "{filter}");
        }
    }
}

pub fn redact_connection_string(input: &str) -> String {
    if input.contains("://") {
        return redact_url_password(input);
    }
    redact_keyword_password(input)
}

fn redact_url_password(input: &str) -> String {
    let scheme_end = match input.find("://") {
        Some(pos) => pos + 3,
        None => return input.to_string(),
    };
    let rest = &input[scheme_end..];
    let auth_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let at = match rest[..auth_end].rfind('@') {
        Some(pos) => pos,
        None => return input.to_string(),
    };
    let userinfo = &rest[..at];
    let colon = match userinfo.find(':') {
        Some(pos) => pos,
        None => return input.to_string(),
    };
    let mut redacted = String::with_capacity(input.len());
    redacted.push_str(&input[..scheme_end]);
    redacted.push_str(&rest[..colon]);
    redacted.push_str(&rest[at..]);
    redacted
}

fn redact_keyword_password(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut pos = 0;
    while pos < input.len() {
        let remaining = &input[pos..];
        let key_pos = match find_password_key(remaining) {
            Some(p) => p,
            None => break,
        };
        let mut cursor = pos + key_pos + "password".len();
        cursor = skip_spaces(input, cursor);
        if input[cursor..].starts_with('=') {
            cursor += 1;
            cursor = skip_spaces(input, cursor);
            let (end, quoted) = scan_value(input, cursor);
            if &input[cursor..end] == "***" || &input[cursor..end] == "'***'" {
                out.push_str(&input[pos..end]);
                pos = end;
                continue;
            }
            out.push_str(&input[pos..cursor]);
            out.push_str(if quoted { "'***'" } else { "***" });
            pos = end;
            continue;
        }
        out.push_str(&input[pos..cursor]);
        pos = cursor;
    }
    out.push_str(&input[pos..]);
    out
}

fn find_password_key(haystack: &str) -> Option<usize> {
    haystack
        .match_indices("password")
        .find(|(pos, _)| {
            let before = haystack[..*pos]
                .chars()
                .next_back()
                .is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
            let after = haystack[pos + "password".len()..].chars().next();
            before && after.is_none_or(|c| c.is_whitespace() || c == '=')
        })
        .map(|(pos, _)| pos)
}

fn skip_spaces(input: &str, mut cursor: usize) -> usize {
    while input[cursor..].starts_with(|c: char| c.is_whitespace()) {
        cursor += 1;
    }
    cursor
}

fn scan_value(input: &str, cursor: usize) -> (usize, bool) {
    let bytes = input.as_bytes();
    if bytes.get(cursor) == Some(&b'\'') {
        let mut end = cursor + 1;
        while end < bytes.len() {
            if bytes[end] == b'\\' {
                end += 2;
                continue;
            }
            if bytes[end] == b'\'' {
                end += 1;
                break;
            }
            end += 1;
        }
        return (end, true);
    }
    let mut end = cursor;
    while end < bytes.len() && !bytes[end].is_ascii_whitespace() {
        end += 1;
    }
    (end, false)
}

fn strip_quoted(input: &str, quote: char) -> String {
    let chars: Vec<char> = input.chars().collect();
    let mut out = String::with_capacity(input.len());
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == quote {
            i += 1;
            while i < chars.len() {
                if chars[i] == quote {
                    if quote == '\'' && i + 1 < chars.len() && chars[i + 1] == '\'' {
                        i += 2;
                        continue;
                    }
                    i += 1;
                    break;
                }
                i += 1;
            }
            out.push(' ');
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn is_word_char(ch: char) -> bool {
    ch.is_alphanumeric() || ch == '_'
}

fn contains_word(haystack: &str, word: &str) -> bool {
    haystack.match_indices(word).any(|(pos, _)| {
        let before = haystack[..pos]
            .chars()
            .next_back()
            .is_none_or(|c| !is_word_char(c));
        let after = haystack[pos + word.len()..]
            .chars()
            .next()
            .is_none_or(|c| !is_word_char(c));
        before && after
    })
}

pub fn validate_table_filter(filter: &str) -> Result<(), String> {
    let stripped = strip_quoted(&strip_quoted(filter, '\''), '"').to_lowercase();
    for token in [";", "--", "/*", "*/"] {
        if stripped.contains(token) {
            return Err(format!(
                "Filter abgelehnt: {token} ist im einfachen Filtermodus nicht erlaubt. Nutze den SQL-Modus für eigene Ausdrücke."
            ));
        }
    }
    for word in ["union", "returning", "into"] {
        if contains_word(&stripped, word) {
            return Err(format!(
                "Filter abgelehnt: {word} ist im einfachen Filtermodus nicht erlaubt. Nutze den SQL-Modus für eigene Ausdrücke."
            ));
        }
    }
    Ok(())
}
