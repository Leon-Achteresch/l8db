import { invoke } from "./core";

export type ObservabilityRow = Record<string, unknown>;

export interface ObservabilityPage<T = ObservabilityRow> {
  rows: T[];
  has_more: boolean;
}

export interface ObservabilitySession {
  pid: number;
  usename: string | null;
  datname: string | null;
  application_name: string | null;
  client_addr: string | null;
  backend_type: string | null;
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  query: string | null;
  backend_start: string | null;
  query_start: string | null;
  xact_start: string | null;
  duration_ms: number | null;
  xact_ms: number | null;
  blocked_by: number[];
}

export interface ObservabilityBlocked {
  pid: number;
  usename: string | null;
  state: string | null;
  wait_event_type: string | null;
  wait_event: string | null;
  query: string | null;
  waiting_ms: number | null;
  blocked_by: number[];
  blockers: { pid: number; usename: string | null; state: string | null; query: string | null }[];
}

export interface ObservabilityLock {
  pid: number | null;
  locktype: string;
  mode: string;
  granted: boolean;
  relation: string | null;
  transaction_id: string | null;
  usename: string | null;
  state: string | null;
  query: string | null;
}

export interface ObservabilityLocks {
  blocked: ObservabilityPage<ObservabilityBlocked>;
  locks: ObservabilityPage<ObservabilityLock>;
}

export interface ObservabilityStatement {
  queryid: string | null;
  query: string;
  role: string | null;
  calls: number;
  total_ms: number;
  mean_ms: number;
  max_ms: number;
  rows: number;
  shared_blks_hit: number;
  shared_blks_read: number;
}

export interface ObservabilityStatements {
  installed: boolean;
  available: boolean;
  schema: string | null;
  page: ObservabilityPage<ObservabilityStatement>;
}

export type StatementOrder = "total" | "mean" | "max" | "calls" | "rows";

export interface ObservabilityHealth {
  database_size: number | null;
  max_connections: number | null;
  table_hit_ratio: number | null;
  index_hit_ratio: number | null;
  connections: ObservabilityPage<{ role: string; state: string; count: number }>;
  long_transactions: ObservabilityPage<{
    pid: number;
    usename: string | null;
    state: string | null;
    query: string | null;
    xact_start: string;
    xact_ms: number;
  }>;
  replication_slots: ObservabilityPage<{
    slot_name: string;
    plugin: string | null;
    slot_type: string;
    database: string | null;
    active: boolean;
    active_pid: number | null;
    retained_wal: string | null;
    retained_bytes: number | null;
  }>;
}

export interface ObservabilitySizes {
  tables: ObservabilityPage<{
    schema: string;
    name: string;
    estimated_rows: number;
    total_bytes: number;
    table_bytes: number;
    index_bytes: number;
  }>;
  indexes: ObservabilityPage<{
    schema: string;
    table: string;
    name: string;
    bytes: number;
    scans: number;
  }>;
  unused_indexes: ObservabilityPage<{
    schema: string;
    table: string;
    name: string;
    bytes: number;
    scans: number;
    definition: string;
  }>;
}

export const LOG_SOURCES = [
  { id: "edge_logs", label: "API-Gateway", levels: true },
  { id: "postgres_logs", label: "Postgres", levels: true },
  { id: "auth_logs", label: "Auth", levels: true },
  { id: "function_edge_logs", label: "Edge Functions (Aufrufe)", levels: true },
  { id: "function_logs", label: "Edge Functions (Ausgabe)", levels: true },
  { id: "storage_logs", label: "Storage", levels: false },
  { id: "realtime_logs", label: "Realtime", levels: false },
] as const;

export type LogSource = (typeof LOG_SOURCES)[number]["id"];
export type LogLevel = "" | "error" | "warning" | "info";

export interface ObservabilityLogRow {
  id: string;
  timestamp: number | string;
  event_message: string | null;
  metadata: unknown;
}

export interface ObservabilityLint {
  name: string;
  title: string;
  level: string;
  facing?: string;
  categories?: string[];
  description?: string;
  detail?: string;
  remediation?: string;
  metadata?: unknown;
  cache_key?: string;
}

export type UsageInterval = "15min" | "30min" | "1hr" | "3hr" | "1day" | "3day" | "7day";

export interface ObservabilityUsageRow {
  timestamp: string | number;
  total_auth_requests?: number;
  total_rest_requests?: number;
  total_storage_requests?: number;
  total_realtime_requests?: number;
  [key: string]: unknown;
}

export const supabaseStudioObservabilitySessions = (reference: string, includeIdle: boolean) =>
  invoke<ObservabilityPage<ObservabilitySession>>("supabase_studio_observability_sessions", {
    reference,
    includeIdle,
  });

export const supabaseStudioObservabilitySignal = (
  reference: string,
  pid: number,
  terminate: boolean,
) => invoke<boolean>("supabase_studio_observability_signal", { reference, pid, terminate });

export const supabaseStudioObservabilityLocks = (reference: string) =>
  invoke<ObservabilityLocks>("supabase_studio_observability_locks", { reference });

export const supabaseStudioObservabilityStatements = (reference: string, order: StatementOrder) =>
  invoke<ObservabilityStatements>("supabase_studio_observability_statements", {
    reference,
    order,
  });

export const supabaseStudioObservabilityStatementsEnable = (reference: string) =>
  invoke<void>("supabase_studio_observability_statements_enable", { reference });

export const supabaseStudioObservabilityStatementsReset = (reference: string) =>
  invoke<void>("supabase_studio_observability_statements_reset", { reference });

export const supabaseStudioObservabilityHealth = (reference: string, longRunningSeconds: number) =>
  invoke<ObservabilityHealth>("supabase_studio_observability_health", {
    reference,
    longRunningSeconds,
  });

export const supabaseStudioObservabilitySizes = (reference: string) =>
  invoke<ObservabilitySizes>("supabase_studio_observability_sizes", { reference });

export const supabaseStudioObservabilityLogs = (
  reference: string,
  options: { source: LogSource; minutes: number; search: string; level: LogLevel; limit: number },
) =>
  invoke<ObservabilityPage<ObservabilityLogRow>>("supabase_studio_observability_logs", {
    reference,
    ...options,
  });

export const supabaseStudioObservabilityAdvisors = (
  reference: string,
  kind: "security" | "performance",
) =>
  invoke<ObservabilityPage<ObservabilityLint>>("supabase_studio_observability_advisors", {
    reference,
    kind,
  });

export const supabaseStudioObservabilityUsage = (reference: string, interval: UsageInterval) =>
  invoke<ObservabilityPage<ObservabilityUsageRow>>("supabase_studio_observability_usage", {
    reference,
    interval,
  });
