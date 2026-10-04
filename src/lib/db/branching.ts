import { invoke } from "./core";

export type BranchKind = "full" | "schema" | "anonymized";
export type BranchMethod = "auto" | "clone" | "stream";
export type ProtectionLevel = "protected" | "masked";
export type MaskStrategy =
  | "keep"
  | "redact"
  | "null"
  | "hash"
  | "email"
  | "name"
  | "phone"
  | "partial"
  | "ip"
  | "zero"
  | "year_only"
  | "uuid"
  | "empty_json"
  | "fixed";
export type ColumnCategory =
  | "text"
  | "number"
  | "date"
  | "timestamp"
  | "json"
  | "uuid"
  | "bytea"
  | "inet"
  | "bool"
  | "other";

export interface MaskRule {
  schema: string;
  table: string;
  column: string;
  strategy: MaskStrategy;
  value?: string;
}

export interface BranchMeta {
  id: string;
  parent: string;
  kind: string;
  method: string;
  status: string;
  source?: string;
  sourceName?: string;
  sourceAt?: string;
  createdAt: string;
  createdBy: string;
  resetAt?: string;
  expiresAt?: string;
  protected: boolean;
  private: boolean;
  masking?: string;
}

export interface DatabaseMarker {
  branch?: BranchMeta;
  protection?: ProtectionLevel;
  masking?: MaskRule[];
}

export interface BranchingDatabase {
  name: string;
  owner: string;
  size: number | null;
  sessions: number;
  ownSessions: number;
  allowConnections: boolean;
  canConnect: boolean;
  isOwner: boolean;
  marker: DatabaseMarker | null;
}

export interface BranchingServer {
  identity: string;
  version: string;
  versionNum: number;
  user: string;
  superuser: boolean;
  createDb: boolean;
  signalBackend: boolean;
  instantClone: boolean;
}

export interface BranchingActor {
  osUser: string;
  host: string;
  dbUser?: string;
}

export interface SnapshotInfo {
  id: string;
  server: string;
  database: string;
  root: string;
  label: string;
  note: string;
  trigger: string;
  createdAt: string;
  createdBy: BranchingActor | null;
  serverVersion: string;
  bytes: number;
  plainBytes: number;
  tables: number;
  rows: number;
  protected: boolean;
  expiresAt: string | null;
  problem: string | null;
}

export interface SnapshotSchedule {
  everyHours: number;
  keep: number;
  connectionId: string;
  lastRunAt?: string | null;
  lastError?: string | null;
}

export interface DatabasePolicy {
  label: string;
  masking: MaskRule[];
  schedule: SnapshotSchedule | null;
  branchTtlHours: number | null;
  snapshotTtlDays: number | null;
}

export interface VaultStatus {
  path: string;
  id: string | null;
  fingerprint: string | null;
  ready: boolean;
  problem: string | null;
  snapshots: number;
  bytes: number;
}

export interface BranchingTools {
  dump: string | null;
  psql: string | null;
  anonymize: boolean;
  problem: string | null;
}

export interface BranchingOverview {
  server: BranchingServer;
  database: string;
  root: string;
  databases: BranchingDatabase[];
  snapshots: SnapshotInfo[];
  policyKey: string;
  policy: DatabasePolicy;
  vault: VaultStatus;
  tools: BranchingTools;
  readOnly: boolean;
}

export interface PiiHint {
  reason: string;
  strategy: MaskStrategy | null;
}

export interface MaskColumn {
  schema: string;
  table: string;
  column: string;
  dataType: string;
  category: ColumnCategory;
  maxLength: number | null;
  notNull: boolean;
  generated: boolean;
  rootSchema: string;
  rootTable: string;
  pii: PiiHint | null;
}

export type BranchingJobState = "running" | "succeeded" | "failed" | "cancelled";

export interface BranchingJob {
  id: string;
  operation: string;
  label: string;
  database: string;
  state: BranchingJobState;
  phase: string;
  done: number;
  total: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  result: Record<string, unknown> | null;
  log: string[];
}

export interface AuditEntry {
  seq: number;
  at: string;
  actor: BranchingActor;
  action: string;
  outcome: string;
  database: string;
  target?: string;
  detail?: Record<string, unknown>;
}

export interface AuditJournal {
  entries: AuditEntry[];
  verification: { valid: boolean; entries: number; problem: string | null };
}

export interface ScheduleEntry {
  key: string;
  server: string;
  database: string;
  schedule: SnapshotSchedule;
}

export interface SnapshotRequest {
  database: string;
  label?: string;
  note?: string;
  scheduled?: boolean;
  server?: string;
}

export type BranchingRun =
  | {
      action: "branch";
      source: string;
      name: string;
      kind: BranchKind;
      method: BranchMethod;
      snapshot: string | null;
      ttlHours: number | null;
      protected: boolean;
    }
  | {
      action: "restore";
      database: string;
      snapshot: string;
      keepHours: number;
      confirm: string;
      reason: string;
    }
  | { action: "reset" | "delete"; name: string; confirm: string }
  | { action: "sweep" };

export type BranchingUpdate =
  | { action: "protection"; database: string; protection: ProtectionLevel | null; confirm: string }
  | { action: "team_masking"; database: string; rules: MaskRule[] }
  | {
      action: "branch";
      name: string;
      protected: boolean;
      expiresAt: string | null;
      confirm: string;
    }
  | { action: "rename"; name: string; to: string };

export type BranchingLocal =
  | {
      action: "snapshot";
      id: string;
      label: string;
      note: string;
      protected: boolean;
      expiresAt: string | null;
    }
  | { action: "delete_snapshot"; id: string }
  | { action: "policy"; key: string; policy: DatabasePolicy };

export type SchemaSource = { kind: "live"; database: string } | { kind: "snapshot"; id: string };

export function branchingOverview(
  connectionString: string,
  database: string,
  toolPaths: Record<string, string>,
): Promise<BranchingOverview> {
  return invoke("branching_overview", { connectionString, database, toolPaths });
}

export function branchingColumns(
  connectionString: string,
  database: string,
): Promise<MaskColumn[]> {
  return invoke("branching_columns", { connectionString, database });
}

export function branchingSchema(
  connectionString: string,
  source: SchemaSource,
  toolPaths: Record<string, string>,
): Promise<string> {
  return invoke("branching_schema", { connectionString, source, toolPaths });
}

export function branchingSnapshot(
  connectionString: string,
  request: SnapshotRequest,
  toolPaths: Record<string, string>,
): Promise<string> {
  return invoke("branching_snapshot", { connectionString, request, toolPaths });
}

export function branchingRun(
  connectionString: string,
  request: BranchingRun,
  toolPaths: Record<string, string>,
): Promise<string> {
  return invoke("branching_run", { connectionString, request, toolPaths });
}

export function branchingUpdate(connectionString: string, request: BranchingUpdate): Promise<void> {
  return invoke("branching_update", { connectionString, request });
}

export function branchingVerify(id: string): Promise<string> {
  return invoke("branching_verify", { id });
}

export function branchingLocal(request: BranchingLocal): Promise<void> {
  return invoke("branching_local", { request });
}

export function branchingSchedules(): Promise<ScheduleEntry[]> {
  return invoke("branching_schedules");
}

export function branchingJobs(): Promise<BranchingJob[]> {
  return invoke("branching_jobs");
}

export function branchingAudit(limit?: number): Promise<AuditJournal> {
  return invoke("branching_audit", { limit });
}

export function branchingAuditExport(): Promise<string> {
  return invoke("branching_audit_export");
}

export function branchingVault(): Promise<VaultStatus> {
  return invoke("branching_vault");
}

export function branchingRecoveryKey(): Promise<string> {
  return invoke("branching_recovery_key");
}

export function branchingRecoveryImport(key: string): Promise<VaultStatus> {
  return invoke("branching_recovery_import", { key });
}
