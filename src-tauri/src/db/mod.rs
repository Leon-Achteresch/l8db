pub mod commands;
pub mod pool;
pub mod secrets;
pub mod ssh;
pub mod transaction;
mod postgres;

use async_trait::async_trait;
use pool::PoolState;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseKind {
    Postgres,
    Mysql,
    Sqlite,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
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
pub trait DatabaseAdapter: Send + Sync {
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
    ) -> Result<(), String>;
    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String>;
    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String>;
    async fn get_view_definition(
        &self,
        schema: &str,
        view: &str,
    ) -> Result<String, String>;
    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String>;
    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String>;
    async fn get_function_definition(&self, oid: &str) -> Result<String, String>;
    async fn list_extensions(&self) -> Result<Vec<ExtensionInfo>, String>;
    async fn list_roles(&self) -> Result<Vec<RoleInfo>, String>;
    async fn create_role(&self, options: &CreateRoleOptions) -> Result<(), String>;
    async fn alter_role(&self, options: &AlterRoleOptions) -> Result<(), String>;
    async fn drop_role(&self, name: &str) -> Result<(), String>;
    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String>;
    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String>;
    async fn list_table_columns_detailed(&self, schema: &str, table: &str) -> Result<Vec<DetailedColumnInfo>, String>;
    async fn add_column(&self, schema: &str, table: &str, column: &AddColumnRequest) -> Result<(), String>;
    async fn alter_column(&self, schema: &str, table: &str, changes: &AlterColumnRequest) -> Result<(), String>;
    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String>;
    async fn list_role_privileges(&self, role_name: &str) -> Result<RolePrivileges, String>;
    async fn modify_privilege(&self, change: &PrivilegeChange) -> Result<(), String>;
    async fn validate_sql(&self, sql: &str) -> Result<(), String>;
    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String>;
    async fn get_er_schema(&self, schema: Option<&str>) -> Result<ERSchema, String>;
    async fn list_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, String>;
    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String>;
    async fn alter_sequence(&self, schema: &str, name: &str, changes: &AlterSequenceRequest) -> Result<(), String>;
    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String>;
    async fn list_constraints(&self, schema: &str, table: &str) -> Result<Vec<ConstraintInfo>, String>;
    async fn install_extension(&self, name: &str, schema: Option<&str>) -> Result<(), String>;
    async fn uninstall_extension(&self, name: &str) -> Result<(), String>;
    async fn list_available_extensions(&self) -> Result<Vec<AvailableExtensionInfo>, String>;
    async fn execute_script(&self, sql: &str) -> Result<Vec<ScriptStatementResult>, String>;
    async fn create_table(&self, req: &CreateTableRequest) -> Result<(), String>;
    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String>;
    async fn list_materialized_views(&self, schema: Option<&str>) -> Result<Vec<MatviewInfo>, String>;
    async fn refresh_materialized_view(&self, schema: &str, name: &str, concurrently: bool) -> Result<(), String>;
    async fn drop_materialized_view(&self, schema: &str, name: &str) -> Result<(), String>;
    async fn create_materialized_view(&self, req: &CreateMatviewRequest) -> Result<(), String>;
    async fn get_table_rls(&self, schema: &str, table: &str) -> Result<TableRlsInfo, String>;
    async fn set_table_rls(&self, schema: &str, table: &str, enabled: bool, force: bool) -> Result<(), String>;
    async fn create_policy(&self, schema: &str, table: &str, policy: &CreatePolicyRequest) -> Result<(), String>;
    async fn drop_policy(&self, schema: &str, table: &str, name: &str) -> Result<(), String>;
    async fn get_partition_info(&self, schema: &str, table: &str) -> Result<PartitionInfo, String>;
    async fn detach_partition(&self, parent_schema: &str, parent_table: &str, child_schema: &str, child_table: &str) -> Result<(), String>;
    async fn attach_partition(&self, parent_schema: &str, parent_table: &str, child_schema: &str, child_table: &str, bound: &str) -> Result<(), String>;
    async fn list_publications(&self) -> Result<Vec<PublicationInfo>, String>;
    async fn create_publication(&self, req: &CreatePublicationRequest) -> Result<(), String>;
    async fn drop_publication(&self, name: &str) -> Result<(), String>;
    async fn list_subscriptions(&self) -> Result<Vec<SubscriptionInfo>, String>;
    async fn create_subscription(&self, req: &CreateSubscriptionRequest) -> Result<(), String>;
    async fn drop_subscription(&self, name: &str) -> Result<(), String>;
    async fn list_sessions(&self) -> Result<Vec<SessionInfo>, String>;
    async fn cancel_session(&self, pid: i32) -> Result<bool, String>;
    async fn terminate_session(&self, pid: i32) -> Result<bool, String>;
    async fn list_locks(&self) -> Result<Vec<LockInfo>, String>;
    async fn list_enums(&self, schema: Option<&str>) -> Result<Vec<EnumInfo>, String>;
    async fn create_schema(&self, name: &str) -> Result<(), String>;
    async fn drop_schema(&self, name: &str, cascade: bool) -> Result<(), String>;
    async fn get_database_overview(&self) -> Result<DatabaseOverview, String>;
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

pub(crate) fn map_pg_err(e: tokio_postgres::Error) -> String {    if let Some(db_err) = e.as_db_error() {
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

pub fn create_adapter(config: ConnectionConfig, pool_state: PoolState) -> Result<Box<dyn DatabaseAdapter>, String> {
    match config.kind {
        DatabaseKind::Postgres => Ok(Box::new(postgres::PostgresAdapter::from_config(config, pool_state))),
        DatabaseKind::Mysql => Err("MySQL wird noch nicht unterstützt. Geplant für Phase 3 (Multi-DB).".to_string()),
        DatabaseKind::Sqlite => Err("SQLite wird noch nicht unterstützt. Geplant für Phase 3 (Multi-DB).".to_string()),
    }
}

pub fn create_adapter_from_string(
    kind: DatabaseKind,
    connection_string: &str,
    database: Option<&str>,
    pool_state: PoolState,
) -> Result<Box<dyn DatabaseAdapter>, String> {
    match kind {
        DatabaseKind::Postgres => Ok(Box::new(
            postgres::PostgresAdapter::from_connection_string(connection_string, database, pool_state)?,
        )),
        DatabaseKind::Mysql => Err("MySQL wird noch nicht unterstützt. Geplant für Phase 3 (Multi-DB).".to_string()),
        DatabaseKind::Sqlite => Err("SQLite wird noch nicht unterstützt. Geplant für Phase 3 (Multi-DB).".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::{redact_connection_string, validate_table_filter};

    #[test]
    fn redacts_password_keeps_user_and_host() {
        assert_eq!(
            redact_connection_string("postgresql://bob:s3cret@db.internal:5432/app?sslmode=require"),
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
            redact_connection_string("host=db.internal port=5432 dbname=app user=bob password=s3cret"),
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
    haystack.match_indices("password").find(|(pos, _)| {
        let before = haystack[..*pos].chars().next_back().is_none_or(|c| !(c.is_alphanumeric() || c == '_'));
        let after = haystack[pos + "password".len()..].chars().next();
        before && after.is_none_or(|c| c.is_whitespace() || c == '=')
    }).map(|(pos, _)| pos)
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
    haystack
        .match_indices(word)
        .any(|(pos, _)| {
            let before = haystack[..pos].chars().next_back().is_none_or(|c| !is_word_char(c));
            let after = haystack[pos + word.len()..].chars().next().is_none_or(|c| !is_word_char(c));
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
