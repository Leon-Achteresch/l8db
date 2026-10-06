use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::DatabaseKind;

pub const EXPORT_FORMAT: u32 = 1;

fn yes() -> bool {
    true
}

fn item_name() -> String {
    "item".into()
}

fn zero_exit() -> Vec<i32> {
    vec![0]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub schedules: Vec<Schedule>,
    #[serde(default)]
    pub variables: Vec<Variable>,
    #[serde(default)]
    pub environments: Vec<Environment>,
    #[serde(default)]
    pub default_environment: Option<String>,
    #[serde(default)]
    pub notifications: Vec<NotificationRule>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub retry: Option<RetryPolicy>,
    #[serde(default)]
    pub max_consecutive_failures: Option<u32>,
    #[serde(default)]
    pub missed_runs: MissedRunPolicy,
    #[serde(default)]
    pub background: bool,
    #[serde(default)]
    pub retention: Option<Retention>,
    #[serde(default)]
    pub needs_review: bool,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VariableKind {
    #[default]
    Text,
    Number,
    Boolean,
    Date,
    Choice,
    Secret,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: VariableKind,
    #[serde(default)]
    pub default_value: String,
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub prompt: bool,
    #[serde(default)]
    pub description: String,
}

pub fn secret_account(
    task_id: &str,
    environment: Option<&Environment>,
    variable: &Variable,
) -> String {
    let key = if variable.id.is_empty() {
        &variable.name
    } else {
        &variable.id
    };
    match environment {
        Some(env) => {
            let scope = if env.id.is_empty() {
                &env.name
            } else {
                &env.id
            };
            format!("automation:var:{task_id}:{scope}:{key}")
        }
        None => format!("automation:var:{task_id}:{key}"),
    }
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Backoff {
    #[default]
    Fixed,
    Exponential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    pub attempts: u32,
    pub delay_seconds: u64,
    #[serde(default)]
    pub backoff: Backoff,
    #[serde(default)]
    pub max_delay_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MissedRunPolicy {
    Skip,
    #[default]
    RunOnce,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Retention {
    #[serde(default)]
    pub keep_days: Option<u32>,
    #[serde(default)]
    pub keep_runs: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Flow {
    #[default]
    Next,
    Goto {
        step_id: String,
    },
    EndSuccess,
    EndFailure,
}

fn fail_flow() -> Flow {
    Flow::EndFailure
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub action: Action,
    #[serde(default)]
    pub on_success: Flow,
    #[serde(default = "fail_flow")]
    pub on_failure: Flow,
    #[serde(default)]
    pub retry: Option<RetryPolicy>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Comparator {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    NotContains,
    Matches,
    Empty,
    NotEmpty,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IfExists {
    #[default]
    Overwrite,
    Append,
    Rename,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    #[serde(default)]
    pub older_than_days: Option<u32>,
    #[serde(default)]
    pub keep_last: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    pub path: String,
    #[serde(default)]
    pub append_timestamp: bool,
    #[serde(default)]
    pub if_exists: IfExists,
    #[serde(default)]
    pub zip: bool,
    #[serde(default)]
    pub cleanup: Option<Cleanup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CsvSettings {
    pub delimiter: String,
    pub quote: String,
    pub header: bool,
    pub null_text: String,
    pub line_ending: String,
    pub bom: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Csv,
    Tsv,
    Json,
    Jsonl,
    Xlsx,
    Xml,
    Html,
    Parquet,
    Markdown,
    Sql,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ExportSource {
    Query {
        sql: String,
    },
    Table {
        schema: String,
        table: String,
        #[serde(default)]
        filter: Option<String>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPairConfig {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableCopyItem {
    pub schema: String,
    pub table: String,
    pub target_schema: String,
    pub target_table: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CopyModeConfig {
    Create,
    Truncate,
    Append,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportFileFormat {
    #[default]
    Csv,
    Json,
    Ndjson,
    Xlsx,
    Parquet,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumn {
    pub source: usize,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    pub constraint: String,
    pub update_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompareSideConfig {
    pub connection: String,
    #[serde(default)]
    pub database: Option<String>,
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Warning,
    #[default]
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum CheckSpec {
    RowCount {
        schema: Option<String>,
        table: Option<String>,
        sql: Option<String>,
        op: Comparator,
        value: f64,
    },
    Value {
        sql: String,
        op: Comparator,
        value: String,
        #[serde(default)]
        tolerance: Option<f64>,
    },
    NotNull {
        schema: String,
        table: String,
        column: String,
    },
    Unique {
        schema: String,
        table: String,
        columns: Vec<String>,
    },
    AcceptedValues {
        schema: String,
        table: String,
        column: String,
        values: Vec<String>,
    },
    Freshness {
        schema: String,
        table: String,
        column: String,
        #[serde(default)]
        warn_after_minutes: Option<u32>,
        error_after_minutes: u32,
    },
    Query {
        sql: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum AlertCondition {
    HasRows,
    NoRows,
    Value {
        #[serde(default)]
        column: Option<String>,
        op: Comparator,
        threshold: String,
    },
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VarQueryMode {
    #[default]
    FirstValue,
    RowCount,
    ColumnList,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VarQuery {
    pub connection: String,
    #[serde(default)]
    pub database: Option<String>,
    pub sql: String,
    #[serde(default)]
    pub mode: VarQueryMode,
    #[serde(default)]
    pub separator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum LoopSource {
    Query {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        sql: String,
    },
    Connections {
        #[serde(default)]
        connections: Vec<String>,
        #[serde(default)]
        tag: Option<String>,
    },
    List {
        values: String,
    },
    Files {
        dir: String,
        pattern: String,
    },
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    #[default]
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ChannelRef {
    Native,
    Email {
        profile_id: String,
        to: Vec<String>,
        #[serde(default)]
        cc: Vec<String>,
    },
    Webhook {
        webhook_id: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Action {
    Sql {
        connections: Vec<String>,
        #[serde(default)]
        database: Option<String>,
        #[serde(default)]
        sql: String,
        #[serde(default)]
        file: Option<String>,
    },
    Export {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        source: ExportSource,
        format: ExportFormat,
        output: OutputSpec,
        #[serde(default)]
        csv: Option<CsvSettings>,
        #[serde(default)]
        sheet_name: Option<String>,
        #[serde(default)]
        max_rows: Option<u64>,
    },
    Backup {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        output: OutputSpec,
        #[serde(default)]
        options: Value,
    },
    Restore {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        path: String,
        #[serde(default)]
        options: Value,
        #[serde(default)]
        allow_production: bool,
    },
    Transfer {
        source: String,
        #[serde(default)]
        source_database: Option<String>,
        target: String,
        #[serde(default)]
        target_database: Option<String>,
        schemas: Vec<SchemaPairConfig>,
        #[serde(default = "yes")]
        fold_names: bool,
    },
    TableCopy {
        source: String,
        #[serde(default)]
        source_database: Option<String>,
        target: String,
        #[serde(default)]
        target_database: Option<String>,
        tables: Vec<TableCopyItem>,
        mode: CopyModeConfig,
        #[serde(default = "yes")]
        include_primary_key: bool,
        #[serde(default)]
        include_indexes: bool,
    },
    Datagen {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        schema: String,
        table: String,
        rows: u64,
        #[serde(default)]
        seed: Option<u64>,
        #[serde(default)]
        locale: crate::db::datagen::Locale,
        #[serde(default = "yes")]
        transaction: bool,
    },
    Import {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        schema: String,
        table: String,
        file: String,
        #[serde(default)]
        format: ImportFileFormat,
        #[serde(default)]
        delimiter: Option<String>,
        #[serde(default = "yes")]
        has_header: bool,
        #[serde(default)]
        sheet: Option<String>,
        columns: Vec<ImportColumn>,
        #[serde(default)]
        conflict: Option<ImportConflict>,
    },
    Compare {
        left: CompareSideConfig,
        right: CompareSideConfig,
        key_columns: Vec<String>,
        #[serde(default)]
        compare_columns: Vec<String>,
        #[serde(default)]
        fail_if_different: bool,
        #[serde(default)]
        report: Option<OutputSpec>,
    },
    Check {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        check: CheckSpec,
        #[serde(default)]
        severity: Severity,
    },
    Alert {
        connection: String,
        #[serde(default)]
        database: Option<String>,
        sql: String,
        condition: AlertCondition,
        #[serde(default)]
        rearm_minutes: Option<u32>,
        #[serde(default = "yes")]
        notify_on_resolve: bool,
    },
    Shell {
        program: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        cwd: Option<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
        #[serde(default = "zero_exit")]
        success_codes: Vec<i32>,
        #[serde(default)]
        capture: Option<String>,
    },
    Http {
        method: HttpMethod,
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
        #[serde(default)]
        body: Option<String>,
        #[serde(default)]
        expect_status: Option<String>,
        #[serde(default)]
        capture: Option<String>,
    },
    FileCopy {
        from: String,
        to: String,
        #[serde(default)]
        overwrite: bool,
    },
    FileMove {
        from: String,
        to: String,
        #[serde(default)]
        overwrite: bool,
    },
    FileDelete {
        path: String,
    },
    Mkdir {
        path: String,
    },
    FileExists {
        path: String,
        #[serde(default = "yes")]
        fail_if_missing: bool,
        #[serde(default)]
        capture: Option<String>,
    },
    Zip {
        sources: Vec<String>,
        output: OutputSpec,
    },
    Unzip {
        archive: String,
        target: String,
        #[serde(default)]
        overwrite: bool,
    },
    Cleanup {
        dir: String,
        pattern: String,
        cleanup: Cleanup,
    },
    Notify {
        channel: ChannelRef,
        title: String,
        body: String,
        #[serde(default)]
        attach_outputs: bool,
    },
    Wait {
        #[serde(default)]
        seconds: Option<u64>,
        #[serde(default)]
        until: Option<String>,
    },
    SetVariable {
        name: String,
        #[serde(default)]
        value: String,
        #[serde(default)]
        query: Option<VarQuery>,
        #[serde(default)]
        calculate: bool,
    },
    Condition {
        left: String,
        op: Comparator,
        #[serde(default)]
        right: String,
        then: Flow,
        otherwise: Flow,
    },
    Loop {
        over: LoopSource,
        steps: Vec<Step>,
        #[serde(default = "item_name")]
        item: String,
        #[serde(default)]
        max_iterations: Option<u32>,
        #[serde(default)]
        continue_on_error: bool,
    },
    RunTask {
        task: String,
        #[serde(default = "yes")]
        wait: bool,
        #[serde(default)]
        vars: BTreeMap<String, String>,
        #[serde(default)]
        environment: Option<String>,
    },
    Log {
        #[serde(default)]
        level: LogLevel,
        message: String,
    },
    Fail {
        message: String,
    },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntervalUnit {
    Minutes,
    Hours,
    Days,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AfterOutcome {
    Success,
    Failure,
    Always,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum Trigger {
    Interval {
        every: u32,
        unit: IntervalUnit,
    },
    Daily {
        times: Vec<String>,
    },
    Weekly {
        weekdays: Vec<u8>,
        times: Vec<String>,
    },
    Monthly {
        #[serde(default)]
        days: Vec<u8>,
        #[serde(default)]
        last_day: bool,
        times: Vec<String>,
    },
    MonthlyNth {
        nth: i8,
        weekday: u8,
        times: Vec<String>,
    },
    Cron {
        expression: String,
    },
    Once {
        at: String,
    },
    AppStart {
        #[serde(default)]
        delay_seconds: u32,
    },
    AfterTask {
        task_id: String,
        on: AfterOutcome,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub trigger: Trigger,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub window: Option<TimeWindow>,
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotifyWhen {
    Success,
    Failure,
    Always,
    Warning,
    AlertTriggered,
    AlertResolved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRule {
    pub id: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub when: NotifyWhen,
    pub channel: ChannelRef,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub attach_outputs: bool,
    #[serde(default)]
    pub skip_if_empty: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SmtpSecurity {
    #[default]
    Starttls,
    Tls,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmtpProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub security: SmtpSecurity,
    #[serde(default)]
    pub username: Option<String>,
    pub from: String,
    #[serde(default)]
    pub reply_to: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WebhookKind {
    Slack,
    Teams,
    Discord,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTarget {
    pub id: String,
    pub name: String,
    pub kind: WebhookKind,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub sign: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSettings {
    #[serde(default = "yes")]
    pub scheduler_enabled: bool,
    #[serde(default)]
    pub smtp_profiles: Vec<SmtpProfile>,
    #[serde(default)]
    pub webhooks: Vec<WebhookTarget>,
    #[serde(default)]
    pub default_retention: Option<Retention>,
    #[serde(default)]
    pub ssh_trust_new_hosts: bool,
    #[serde(default)]
    pub backup_tool_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub default_output_dir: Option<String>,
    #[serde(default = "yes")]
    pub notify_native_on_failure: bool,
    #[serde(default)]
    pub max_parallel_runs: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SshAuthKind {
    Password,
    Key,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshJumpDescriptor {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthKind,
    #[serde(default)]
    pub key_file: String,
    #[serde(default)]
    pub agent_socket: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshDescriptor {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthKind,
    #[serde(default)]
    pub key_file: String,
    #[serde(default)]
    pub agent_socket: Option<String>,
    #[serde(default)]
    pub jump_hosts: Vec<SshJumpDescriptor>,
    #[serde(default)]
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyKind {
    Socks5,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDescriptor {
    #[serde(rename = "type")]
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationConnection {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub connection_string: String,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub ssh: Option<SshDescriptor>,
    #[serde(default)]
    pub proxy: Option<ProxyDescriptor>,
    #[serde(default)]
    pub vault: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    #[default]
    Running,
    Success,
    Warning,
    Failed,
    Cancelled,
    Timeout,
    Skipped,
    Interrupted,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    #[default]
    Manual,
    Schedule,
    AppStart,
    AfterTask,
    Cli,
    Background,
    RunTask,
    Rerun,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub trigger: TriggerKind,
    pub trigger_detail: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    pub environment: Option<String>,
    pub rerun_of: Option<String>,
    pub parent_run_id: Option<String>,
    pub steps_total: u32,
    pub steps_done: u32,
    pub outputs: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepRun {
    pub seq: u32,
    pub step_id: String,
    pub step_name: String,
    pub kind: String,
    pub depth: u8,
    pub iteration: Option<u32>,
    pub attempt: u32,
    pub status: RunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub rows: Option<u64>,
    pub rows_affected: Option<u64>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub seq: u32,
    pub at: String,
    pub level: LogLevel,
    pub step_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunOutput {
    pub step_id: String,
    pub path: String,
    pub bytes: Option<u64>,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub summary: RunSummary,
    pub steps: Vec<StepRun>,
    pub logs: Vec<LogLine>,
    pub outputs: Vec<RunOutput>,
    pub vars: BTreeMap<String, String>,
    pub definition: Task,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    pub task_id: String,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_run_id: Option<String>,
    pub last_status: Option<RunStatus>,
    pub consecutive_failures: u32,
    pub disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskStats {
    pub runs: u32,
    pub success_rate: Option<f64>,
    pub average_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub task: Task,
    pub state: TaskState,
    pub running_run_id: Option<String>,
    pub stats: TaskStats,
    pub alerts: Vec<AlertState>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlertStatus {
    #[default]
    Unknown,
    Ok,
    Triggered,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertState {
    pub task_id: String,
    pub step_id: String,
    pub status: AlertStatus,
    pub since: Option<String>,
    pub checked_at: Option<String>,
    pub last_notified_at: Option<String>,
    pub last_value: Option<String>,
    pub muted_until: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunFilter {
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub statuses: Vec<RunStatus>,
    #[serde(default)]
    pub triggers: Vec<TriggerKind>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub step_id: Option<String>,
    pub field: String,
    pub message: String,
    pub severity: Severity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: Vec<String>,
    pub renamed: Vec<String>,
    pub needs_review: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskExportFile {
    pub format: u32,
    pub exported_at: String,
    pub app_version: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundStatus {
    pub supported: bool,
    pub installed: bool,
    pub mechanism: String,
    pub location: Option<String>,
    pub binary: String,
    pub last_tick_at: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiActivity {
    #[serde(default)]
    pub seq: u64,
    #[serde(default)]
    pub at: String,
    pub source: String,
    pub action: String,
    pub task_id: String,
    #[serde(default)]
    pub step_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCheck {
    pub ok: bool,
    pub via: String,
    pub message: String,
}

impl Default for AutomationSettings {
    fn default() -> Self {
        serde_json::from_value(serde_json::json!({})).expect("leere Einstellungen")
    }
}

impl Action {
    pub fn kind(&self) -> &'static str {
        match self {
            Action::Sql { .. } => "sql",
            Action::Export { .. } => "export",
            Action::Backup { .. } => "backup",
            Action::Restore { .. } => "restore",
            Action::Transfer { .. } => "transfer",
            Action::TableCopy { .. } => "table_copy",
            Action::Datagen { .. } => "datagen",
            Action::Import { .. } => "import",
            Action::Compare { .. } => "compare",
            Action::Check { .. } => "check",
            Action::Alert { .. } => "alert",
            Action::Shell { .. } => "shell",
            Action::Http { .. } => "http",
            Action::FileCopy { .. } => "file_copy",
            Action::FileMove { .. } => "file_move",
            Action::FileDelete { .. } => "file_delete",
            Action::Mkdir { .. } => "mkdir",
            Action::FileExists { .. } => "file_exists",
            Action::Zip { .. } => "zip",
            Action::Unzip { .. } => "unzip",
            Action::Cleanup { .. } => "cleanup",
            Action::Notify { .. } => "notify",
            Action::Wait { .. } => "wait",
            Action::SetVariable { .. } => "set_variable",
            Action::Condition { .. } => "condition",
            Action::Loop { .. } => "loop",
            Action::RunTask { .. } => "run_task",
            Action::Log { .. } => "log",
            Action::Fail { .. } => "fail",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE: &str = include_str!("fixtures/task-v1.json");

    #[test]
    fn task_roundtrip_matches_fixture() {
        let original: Value = serde_json::from_str(FIXTURE).unwrap();
        let task: Task = serde_json::from_value(original.clone()).unwrap();
        assert_eq!(serde_json::to_value(&task).unwrap(), original);
        let mut kinds: Vec<&str> = Vec::new();
        fn collect<'a>(steps: &'a [Step], kinds: &mut Vec<&'a str>) {
            for step in steps {
                kinds.push(step.action.kind());
                if let Action::Loop { steps, .. } = &step.action {
                    collect(steps, kinds);
                }
            }
        }
        collect(&task.steps, &mut kinds);
        kinds.sort();
        kinds.dedup();
        assert_eq!(kinds.len(), 29);
    }

    #[test]
    fn secret_account_prefers_stable_ids() {
        let task: Task = serde_json::from_value(serde_json::json!({
            "id": "t",
            "name": "Secrets",
            "variables": [
                { "name": "legacy", "kind": "secret" },
                { "id": "var-1", "name": "renamed", "kind": "secret" }
            ],
            "environments": [
                { "name": "prod" },
                { "id": "env-1", "name": "test" }
            ]
        }))
        .unwrap();
        let [legacy, stable] = [&task.variables[0], &task.variables[1]];
        let [prod, test] = [&task.environments[0], &task.environments[1]];
        assert_eq!(secret_account("t", None, legacy), "automation:var:t:legacy");
        assert_eq!(secret_account("t", None, stable), "automation:var:t:var-1");
        assert_eq!(
            secret_account("t", Some(prod), stable),
            "automation:var:t:prod:var-1"
        );
        assert_eq!(
            secret_account("t", Some(test), legacy),
            "automation:var:t:env-1:legacy"
        );
        let json = serde_json::to_value(legacy).unwrap();
        assert!(json.get("id").is_none());
    }

    #[test]
    fn defaults_fill_missing_fields() {
        let task: Task = serde_json::from_value(serde_json::json!({
            "id": "t",
            "name": "Minimal",
            "steps": [
                { "id": "a", "name": "Log", "action": { "type": "log", "message": "hi" } },
                { "id": "b", "name": "Shell", "action": { "type": "shell", "program": "true" } },
                { "id": "c", "name": "Loop", "action": { "type": "loop", "over": { "type": "list", "values": "a,b" }, "steps": [] } },
                { "id": "d", "name": "Transfer", "action": { "type": "transfer", "source": "x", "target": "y", "schemas": [] } }
            ],
            "schedules": [{ "id": "s", "trigger": { "type": "app_start" } }]
        }))
        .unwrap();
        assert!(task.enabled);
        assert!(task.steps.iter().all(|step| step.enabled));
        assert_eq!(task.steps[0].on_success, Flow::Next);
        assert_eq!(task.steps[0].on_failure, Flow::EndFailure);
        assert_eq!(task.missed_runs, MissedRunPolicy::RunOnce);
        assert_eq!(task.revision, 0);
        assert!(!task.needs_review);
        assert!(matches!(
            task.steps[0].action,
            Action::Log {
                level: LogLevel::Info,
                ..
            }
        ));
        assert!(
            matches!(&task.steps[1].action, Action::Shell { success_codes, .. } if success_codes == &vec![0])
        );
        assert!(matches!(&task.steps[2].action, Action::Loop { item, .. } if item == "item"));
        assert!(matches!(
            task.steps[3].action,
            Action::Transfer {
                fold_names: true,
                ..
            }
        ));
        assert!(task.schedules[0].enabled);
        assert_eq!(
            task.schedules[0].trigger,
            Trigger::AppStart { delay_seconds: 0 }
        );
        let settings = AutomationSettings::default();
        assert!(settings.scheduler_enabled);
        assert!(settings.notify_native_on_failure);
        assert!(!settings.ssh_trust_new_hosts);
        assert_eq!(settings.max_parallel_runs, None);
    }
}
