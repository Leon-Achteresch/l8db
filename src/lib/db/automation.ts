import type { BackupOptions } from "./backup";
import { invoke } from "./core";
import type { DatagenLocale } from "./datagen";
import type { DatabaseKind } from "./providers";

export type VariableKind = "text" | "number" | "boolean" | "date" | "choice" | "secret";
export type Backoff = "fixed" | "exponential";
export type MissedRunPolicy = "skip" | "run_once";
export type Comparator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "matches"
  | "empty"
  | "not_empty";
export type IfExists = "overwrite" | "append" | "rename" | "fail";
export type ExportFormat =
  | "csv"
  | "tsv"
  | "json"
  | "jsonl"
  | "xlsx"
  | "xml"
  | "html"
  | "parquet"
  | "markdown"
  | "sql";
export type CopyModeConfig = "create" | "truncate" | "append";
export type ImportFileFormat = "csv" | "json" | "ndjson" | "xlsx" | "parquet";
export type Severity = "warning" | "error";
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type VarQueryMode = "first_value" | "row_count" | "column_list" | "json";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type IntervalUnit = "minutes" | "hours" | "days";
export type AfterOutcome = "success" | "failure" | "always";
export type NotifyWhen =
  | "success"
  | "failure"
  | "always"
  | "warning"
  | "alert_triggered"
  | "alert_resolved";
export type SmtpSecurity = "starttls" | "tls" | "none";
export type WebhookKind = "slack" | "teams" | "discord" | "generic";
export type SshAuthKind = "password" | "key" | "agent";
export type ProxyKind = "socks5" | "http";
export type RunStatus =
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "cancelled"
  | "timeout"
  | "skipped"
  | "interrupted";
export type TriggerKind =
  | "manual"
  | "schedule"
  | "app_start"
  | "after_task"
  | "cli"
  | "background"
  | "run_task"
  | "rerun";
export type AlertStatus = "unknown" | "ok" | "triggered" | "error";

export interface Environment {
  id?: string;
  name: string;
  variables: Record<string, string>;
}

export interface Variable {
  id?: string;
  name: string;
  kind: VariableKind;
  defaultValue: string;
  choices: string[];
  prompt: boolean;
  description: string;
}

export interface RetryPolicy {
  attempts: number;
  delaySeconds: number;
  backoff: Backoff;
  maxDelaySeconds: number | null;
}

export interface Retention {
  keepDays: number | null;
  keepRuns: number | null;
}

export type Flow =
  | { type: "next" }
  | { type: "goto"; stepId: string }
  | { type: "end_success" }
  | { type: "end_failure" };

export interface Cleanup {
  olderThanDays: number | null;
  keepLast: number | null;
}

export interface OutputSpec {
  path: string;
  appendTimestamp: boolean;
  ifExists: IfExists;
  zip: boolean;
  cleanup: Cleanup | null;
}

export interface CsvSettings {
  delimiter: string;
  quote: string;
  header: boolean;
  nullText: string;
  lineEnding: string;
  bom: boolean;
}

export type ExportSource =
  | { type: "query"; sql: string }
  | { type: "table"; schema: string; table: string; filter: string | null };

export interface SchemaPairConfig {
  source: string;
  target: string;
}

export interface TableCopyItem {
  schema: string;
  table: string;
  targetSchema: string;
  targetTable: string;
}

export interface ImportColumn {
  source: number;
  target: string;
}

export interface ImportConflict {
  constraint: string;
  updateColumns: string[];
}

export interface CompareSideConfig {
  connection: string;
  database: string | null;
  schema: string;
  table: string;
  filter: string | null;
}

export type CheckSpec =
  | {
      type: "row_count";
      schema: string | null;
      table: string | null;
      sql: string | null;
      op: Comparator;
      value: number;
    }
  | { type: "value"; sql: string; op: Comparator; value: string; tolerance: number | null }
  | { type: "not_null"; schema: string; table: string; column: string }
  | { type: "unique"; schema: string; table: string; columns: string[] }
  | { type: "accepted_values"; schema: string; table: string; column: string; values: string[] }
  | {
      type: "freshness";
      schema: string;
      table: string;
      column: string;
      warnAfterMinutes: number | null;
      errorAfterMinutes: number;
    }
  | { type: "query"; sql: string };

export type AlertCondition =
  | { type: "has_rows" }
  | { type: "no_rows" }
  | { type: "value"; column: string | null; op: Comparator; threshold: string }
  | { type: "error" };

export interface VarQuery {
  connection: string;
  database: string | null;
  sql: string;
  mode: VarQueryMode;
  separator: string | null;
}

export type LoopSource =
  | { type: "query"; connection: string; database: string | null; sql: string }
  | { type: "connections"; connections: string[]; tag: string | null }
  | { type: "list"; values: string }
  | { type: "files"; dir: string; pattern: string };

export type ChannelRef =
  | { type: "native" }
  | { type: "email"; profileId: string; to: string[]; cc: string[] }
  | { type: "webhook"; webhookId: string };

export type Action =
  | {
      type: "sql";
      connections: string[];
      database: string | null;
      sql: string;
      file: string | null;
    }
  | {
      type: "export";
      connection: string;
      database: string | null;
      source: ExportSource;
      format: ExportFormat;
      output: OutputSpec;
      csv: CsvSettings | null;
      sheetName: string | null;
      maxRows: number | null;
    }
  | {
      type: "backup";
      connection: string;
      database: string | null;
      output: OutputSpec;
      options: Partial<BackupOptions>;
    }
  | {
      type: "restore";
      connection: string;
      database: string | null;
      path: string;
      options: Partial<BackupOptions>;
      allowProduction: boolean;
    }
  | {
      type: "transfer";
      source: string;
      sourceDatabase: string | null;
      target: string;
      targetDatabase: string | null;
      schemas: SchemaPairConfig[];
      foldNames: boolean;
    }
  | {
      type: "table_copy";
      source: string;
      sourceDatabase: string | null;
      target: string;
      targetDatabase: string | null;
      tables: TableCopyItem[];
      mode: CopyModeConfig;
      includePrimaryKey: boolean;
      includeIndexes: boolean;
    }
  | {
      type: "datagen";
      connection: string;
      database: string | null;
      schema: string;
      table: string;
      rows: number;
      seed: number | null;
      locale: DatagenLocale;
      transaction: boolean;
    }
  | {
      type: "import";
      connection: string;
      database: string | null;
      schema: string;
      table: string;
      file: string;
      format: ImportFileFormat;
      delimiter: string | null;
      hasHeader: boolean;
      sheet: string | null;
      columns: ImportColumn[];
      conflict: ImportConflict | null;
    }
  | {
      type: "compare";
      left: CompareSideConfig;
      right: CompareSideConfig;
      keyColumns: string[];
      compareColumns: string[];
      failIfDifferent: boolean;
      report: OutputSpec | null;
    }
  | {
      type: "check";
      connection: string;
      database: string | null;
      check: CheckSpec;
      severity: Severity;
    }
  | {
      type: "alert";
      connection: string;
      database: string | null;
      sql: string;
      condition: AlertCondition;
      rearmMinutes: number | null;
      notifyOnResolve: boolean;
    }
  | {
      type: "shell";
      program: string;
      args: string[];
      cwd: string | null;
      env: Record<string, string>;
      successCodes: number[];
      capture: string | null;
    }
  | {
      type: "http";
      method: HttpMethod;
      url: string;
      headers: Record<string, string>;
      body: string | null;
      expectStatus: string | null;
      capture: string | null;
    }
  | { type: "file_copy"; from: string; to: string; overwrite: boolean }
  | { type: "file_move"; from: string; to: string; overwrite: boolean }
  | { type: "file_delete"; path: string }
  | { type: "mkdir"; path: string }
  | { type: "file_exists"; path: string; failIfMissing: boolean; capture: string | null }
  | { type: "zip"; sources: string[]; output: OutputSpec }
  | { type: "unzip"; archive: string; target: string; overwrite: boolean }
  | { type: "cleanup"; dir: string; pattern: string; cleanup: Cleanup }
  | { type: "notify"; channel: ChannelRef; title: string; body: string; attachOutputs: boolean }
  | { type: "wait"; seconds: number | null; until: string | null }
  | {
      type: "set_variable";
      name: string;
      value: string;
      query: VarQuery | null;
      calculate: boolean;
    }
  | { type: "condition"; left: string; op: Comparator; right: string; then: Flow; otherwise: Flow }
  | {
      type: "loop";
      over: LoopSource;
      steps: Step[];
      item: string;
      maxIterations: number | null;
      continueOnError: boolean;
    }
  | {
      type: "run_task";
      task: string;
      wait: boolean;
      vars: Record<string, string>;
      environment: string | null;
    }
  | { type: "log"; level: LogLevel; message: string }
  | { type: "fail"; message: string };

export type ActionType = Action["type"];

export interface Step {
  id: string;
  name: string;
  enabled: boolean;
  action: Action;
  onSuccess: Flow;
  onFailure: Flow;
  retry: RetryPolicy | null;
  timeoutSeconds: number | null;
}

export type Trigger =
  | { type: "interval"; every: number; unit: IntervalUnit }
  | { type: "daily"; times: string[] }
  | { type: "weekly"; weekdays: number[]; times: string[] }
  | { type: "monthly"; days: number[]; lastDay: boolean; times: string[] }
  | { type: "monthly_nth"; nth: number; weekday: number; times: string[] }
  | { type: "cron"; expression: string }
  | { type: "once"; at: string }
  | { type: "app_start"; delaySeconds: number }
  | { type: "after_task"; taskId: string; on: AfterOutcome };

export interface TimeWindow {
  from: string;
  to: string;
}

export interface Schedule {
  id: string;
  enabled: boolean;
  trigger: Trigger;
  timezone: string | null;
  startAt: string | null;
  endAt: string | null;
  exclusions: string[];
  window: TimeWindow | null;
  vars: Record<string, string>;
  environment: string | null;
}

export interface NotificationRule {
  id: string;
  enabled: boolean;
  when: NotifyWhen;
  channel: ChannelRef;
  title: string;
  body: string;
  attachOutputs: boolean;
  skipIfEmpty: boolean;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  folder: string;
  tags: string[];
  enabled: boolean;
  steps: Step[];
  schedules: Schedule[];
  variables: Variable[];
  environments: Environment[];
  defaultEnvironment: string | null;
  notifications: NotificationRule[];
  timeoutSeconds: number | null;
  retry: RetryPolicy | null;
  maxConsecutiveFailures: number | null;
  missedRuns: MissedRunPolicy;
  background: boolean;
  retention: Retention | null;
  needsReview: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmtpProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  from: string;
  replyTo: string | null;
}

export interface WebhookTarget {
  id: string;
  name: string;
  kind: WebhookKind;
  headers: Record<string, string>;
  sign: boolean;
}

export interface AutomationSettings {
  schedulerEnabled: boolean;
  smtpProfiles: SmtpProfile[];
  webhooks: WebhookTarget[];
  defaultRetention: Retention | null;
  sshTrustNewHosts: boolean;
  backupToolPaths: Record<string, string>;
  defaultOutputDir: string | null;
  notifyNativeOnFailure: boolean;
  maxParallelRuns: number | null;
}

export interface SshJumpDescriptor {
  host: string;
  port: number;
  user: string;
  auth: SshAuthKind;
  keyFile: string;
  agentSocket: string | null;
}

export interface SshDescriptor {
  host: string;
  port: number;
  user: string;
  auth: SshAuthKind;
  keyFile: string;
  agentSocket: string | null;
  jumpHosts: SshJumpDescriptor[];
  remoteHost: string;
  remotePort: number;
}

export interface ProxyDescriptor {
  type: ProxyKind;
  host: string;
  port: number;
  username: string | null;
}

export interface AutomationConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  readOnly: boolean;
  environment: string | null;
  tags: string[];
  ssh: SshDescriptor | null;
  proxy: ProxyDescriptor | null;
  vault: boolean;
}

export interface RunSummary {
  id: string;
  taskId: string;
  taskName: string;
  trigger: TriggerKind;
  triggerDetail: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  environment: string | null;
  rerunOf: string | null;
  parentRunId: string | null;
  stepsTotal: number;
  stepsDone: number;
  outputs: number;
}

export interface StepRun {
  seq: number;
  stepId: string;
  stepName: string;
  kind: string;
  depth: number;
  iteration: number | null;
  attempt: number;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  rows: number | null;
  rowsAffected: number | null;
  message: string | null;
  error: string | null;
}

export interface LogLine {
  seq: number;
  at: string;
  level: LogLevel;
  stepId: string | null;
  message: string;
}

export interface RunOutput {
  stepId: string;
  path: string;
  bytes: number | null;
  format: string;
}

export interface RunDetail {
  summary: RunSummary;
  steps: StepRun[];
  logs: LogLine[];
  outputs: RunOutput[];
  vars: Record<string, string>;
  definition: Task;
}

export interface TaskState {
  taskId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: RunStatus | null;
  consecutiveFailures: number;
  disabledReason: string | null;
}

export interface TaskStats {
  runs: number;
  successRate: number | null;
  averageMs: number | null;
}

export interface AlertState {
  taskId: string;
  stepId: string;
  status: AlertStatus;
  since: string | null;
  checkedAt: string | null;
  lastNotifiedAt: string | null;
  lastValue: string | null;
  mutedUntil: string | null;
}

export interface TaskSummary {
  task: Task;
  state: TaskState;
  runningRunId: string | null;
  stats: TaskStats;
  alerts: AlertState[];
}

export interface RunFilter {
  taskId?: string | null;
  statuses?: RunStatus[];
  triggers?: TriggerKind[];
  from?: string | null;
  to?: string | null;
  text?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface ValidationIssue {
  stepId: string | null;
  field: string;
  message: string;
  severity: Severity;
}

export interface ImportReport {
  imported: string[];
  renamed: string[];
  needsReview: string[];
}

export interface BackgroundStatus {
  supported: boolean;
  installed: boolean;
  mechanism: string;
  location: string | null;
  binary: string;
  lastTickAt: string | null;
  detail: string | null;
}

export interface ConnectionCheck {
  ok: boolean;
  via: string;
  message: string;
}

export interface RunTaskInput {
  taskId: string;
  vars?: Record<string, string>;
  environment?: string | null;
  fromStep?: string | null;
  rerunOf?: string | null;
  useOriginalDefinition?: boolean;
}

export type AutomationEvent =
  | { event: "run_started"; run: RunSummary }
  | { event: "run_step"; runId: string; taskId: string; step: StepRun }
  | { event: "run_log"; runId: string; line: LogLine }
  | { event: "run_finished"; run: RunSummary }
  | { event: "tasks_changed"; ids: string[] }
  | { event: "alert_changed"; alert: AlertState };

export const syncAutomationConnections = (connections: AutomationConnection[]) =>
  invoke<void>("automation_sync_connections", { connections });
export const listAutomationTasks = () => invoke<TaskSummary[]>("automation_list_tasks");
export const getAutomationTask = (id: string) => invoke<Task>("automation_get_task", { id });
export const saveAutomationTask = (task: Task, expectedRevision: number | null) =>
  invoke<TaskSummary>("automation_save_task", { task, expectedRevision });
export const deleteAutomationTasks = (ids: string[]) =>
  invoke<void>("automation_delete_tasks", { ids });
export const duplicateAutomationTask = (id: string) =>
  invoke<TaskSummary>("automation_duplicate_task", { id });
export const setAutomationTasksEnabled = (ids: string[], enabled: boolean) =>
  invoke<TaskSummary[]>("automation_set_enabled", { ids, enabled });
export const validateAutomationTask = (task: Task) =>
  invoke<ValidationIssue[]>("automation_validate_task", { task });
export const exportAutomationTasks = (ids: string[], path: string) =>
  invoke<number>("automation_export_tasks", { ids, path });
export const importAutomationTasks = (path: string) =>
  invoke<ImportReport>("automation_import_tasks", { path });
export const runAutomationTask = (input: RunTaskInput) =>
  invoke<string>("automation_run_task", { input });
export const cancelAutomationRun = (runId: string) =>
  invoke<boolean>("automation_cancel_run", { runId });
export const listAutomationRuns = (filter: RunFilter) =>
  invoke<RunSummary[]>("automation_list_runs", { filter });
export const getAutomationRun = (runId: string) =>
  invoke<RunDetail>("automation_get_run", { runId });
export const deleteAutomationRuns = (ids: string[]) =>
  invoke<number>("automation_delete_runs", { ids });
export const exportAutomationRuns = (filter: RunFilter, format: "json" | "csv", path: string) =>
  invoke<number>("automation_export_runs", { filter, format, path });
export const previewAutomationSchedule = (schedule: Schedule, count = 5) =>
  invoke<string[]>("automation_preview_schedule", { schedule, count });
export const automationNextRuns = (hours: number) =>
  invoke<{ taskId: string; at: string }[]>("automation_next_runs", { hours });
export const getAutomationSettings = () => invoke<AutomationSettings>("automation_get_settings");
export const saveAutomationSettings = (settings: AutomationSettings) =>
  invoke<AutomationSettings>("automation_save_settings", { settings });
export const testAutomationChannel = (channel: ChannelRef) =>
  invoke<void>("automation_test_channel", { channel });
export const testAutomationConnection = (connection: string) =>
  invoke<ConnectionCheck>("automation_test_connection", { connection });
export const setAutomationAlertMute = (taskId: string, stepId: string, until: string | null) =>
  invoke<AlertState>("automation_set_alert_mute", { taskId, stepId, until });
export const automationBackgroundStatus = () =>
  invoke<BackgroundStatus>("automation_background_status");
export const installAutomationBackground = () =>
  invoke<BackgroundStatus>("automation_install_background");
export const uninstallAutomationBackground = () =>
  invoke<BackgroundStatus>("automation_uninstall_background");
export const automationCliCommand = (taskId: string) =>
  invoke<string>("automation_cli_command", { taskId });
export const onAutomationEvent = async (handler: (event: AutomationEvent) => void) => {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<AutomationEvent>("automation-event", ({ payload }) => handler(payload));
};
