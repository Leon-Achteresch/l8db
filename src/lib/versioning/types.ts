import type { CompareSideSelection } from "@/lib/compare-types";

export type VersioningKind =
  | "postgres"
  | "oracle"
  | "mysql"
  | "mssql"
  | "sqlite"
  | "duckdb"
  | "clickhouse";

export type DeployKind = "postgres" | "oracle";

export interface ManagedObject {
  id: string;
  path: string;
  bodyPath?: string;
  metadataVersion?: 2 | 3;
  selection: Omit<CompareSideSelection, "connectionId" | "database">;
}

export interface VersioningProject {
  format: 1;
  id: string;
  name: string;
  kind: VersioningKind;
  objects: ManagedObject[];
  additiveOnly?: boolean;
}

export interface ObjectSnapshot {
  object: ManagedObject;
  definition: string;
  checksum: string;
}

export type ChangeKind = "versioned" | "repeatable";

export interface ChangeRules {
  kind?: ChangeKind;
  touches?: string[];
  before?: Record<string, string | null>;
  requires?: string[];
  data?: boolean;
  preconditions?: ReleaseCheck[];
  postconditions?: ReleaseCheck[];
  destructive?: boolean;
}

export interface ReleaseMigration extends ChangeRules {
  id: string;
  title: string;
  sql: string;
  checksum: string;
}

export interface DatabaseRelease {
  format: 1 | 2;
  id: string;
  projectId: string;
  kind: DeployKind;
  parent?: string | null;
  parents?: string[];
  changes?: string[];
  createdAt: string;
  objects: ObjectSnapshot[];
  migrations: ReleaseMigration[];
  track?: string;
  safety?: ReleaseSafety;
}

export interface ChangeFile extends ChangeRules {
  format: 1;
  id: string;
  title: string;
  checksum: string;
  touches: string[];
}

export interface StandaloneChange extends ChangeFile {
  sql: string;
}

export interface Change {
  id: string;
  release: string | null;
  title: string;
  sql: string;
  checksum: string;
  kind: ChangeKind;
  touches: string[];
  before: Record<string, string | null>;
  requires: string[];
  data: boolean;
  destructive: boolean;
  preconditions: ReleaseCheck[];
  postconditions: ReleaseCheck[];
}

export interface AppliedChange {
  id: string;
  checksum: string;
  kind: ChangeKind;
  source: "rollout" | "baseline" | "adopted" | "script" | "migrated";
  release: string | null;
}

export interface AppliedObject {
  id: string;
  hash: string;
  change: string | null;
}

export interface Variance {
  object: string;
  hash: string;
  reason: string;
  until: string | null;
}

export interface ReleaseCheck {
  id: string;
  title: string;
  sql: string;
  expected: string;
  checksum: string;
}

export interface ReleaseSafety {
  phase: "expand" | "backfill" | "contract" | "custom";
  compatibility: "online" | "maintenance";
  notes: string;
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  preconditions: ReleaseCheck[];
  postconditions: ReleaseCheck[];
}

export interface ReleaseReference {
  id: string;
  commit: string;
  path: string;
}

export interface DeploymentEvent {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  from: ReleaseReference | null;
  to: ReleaseReference;
  status: "running" | "succeeded" | "failed" | "reconciled";
  completedMigrations: string[];
  error: string | null;
  checked?: string[];
  completedStatements?: string[];
  inFlightStatement?: string | null;
}

export type TargetStage = "development" | "test" | "production";

export interface DeliveryRules {
  repository: string;
  review: boolean;
  approvals: number;
  testFirst: boolean;
}

export interface DatabaseTarget {
  id: string;
  name: string;
  customer?: string;
  environment?: string;
  stage?: TargetStage;
  connectionId: string;
  connectionRef?: string;
  expectedPhysicalKey?: string;
  database: string | null;
  production: boolean;
  schema?: string | null;
  release: ReleaseReference | null;
  history: DeploymentEvent[];
  track?: string;
  pinnedRelease?: string | null;
  paused?: boolean;
  ledgerSchema?: string;
  variances?: Variance[];
  ledger?: { tip: string; open: number; variances: number; checkedAt: string };
  requireApproval?: boolean;
  operators?: string[];
  administrators?: string[];
  reviewers?: string[];
  binding?: {
    locationFingerprint?: string;
    fingerprint: string;
    label: string;
    edition: string | null;
    physicalKey?: string;
  };
}

export interface TargetStore {
  format: 1;
  projectId: string;
  targets: DatabaseTarget[];
  connections?: TeamConnection[];
  branches?: Record<string, TeamBranch>;
  teamConfigured?: boolean;
  connectionBindings?: Record<string, string>;
}

export interface TeamConnection {
  id: string;
  name: string;
  kind: VersioningProject["kind"];
  host: string;
  port: string;
  service: string | null;
  sslMode: string;
  requiresTunnel: boolean;
}

export interface TeamBranch {
  targetId?: string;
  source?: { connectionRef: string; database: string | null; schema: string | null };
}

export type TeamTarget = Omit<
  DatabaseTarget,
  "connectionId" | "binding" | "release" | "history"
> & {
  connectionRef: string;
};

export interface TeamConfiguration {
  format: 1;
  projectId: string;
  connections: TeamConnection[];
  targets: TeamTarget[];
  branches: Record<string, TeamBranch>;
}

export interface RepositoryStatus {
  repo: string;
  head: string | null;
  branch: string | null;
  branches: string[];
  files: string[];
  changes: string;
  history: string;
}

export interface RepositoryRequest {
  action:
    | "graph"
    | "show"
    | "release-commits"
    | "merge-branch"
    | "delete-branch"
    | "fetch"
    | "pull"
    | "push"
    | "init"
    | "status"
    | "files"
    | "read"
    | "read-many"
    | "drift-cache-read"
    | "drift-cache-write"
    | "write"
    | "delete"
    | "diff"
    | "commit"
    | "branch"
    | "checkout"
    | "local-read"
    | "local-write"
    | "targets-write"
    | "merge-base"
    | "merge"
    | "remote"
    | "between";
  repo: string;
  path?: string;
  content?: string;
  expected?: string | null;
  revision?: string;
  name?: string;
  paths?: string[];
  base?: string;
  incoming?: string;
  limit?: number;
}

export interface RemoteStatus {
  configured: boolean;
  identity?: string | null;
  web?: string | null;
  kind?: "github" | "gitlab" | "azure" | "gitea" | null;
  defaultBranch?: string | null;
  defaultCommit?: string | null;
  head?: string | null;
  branch?: string | null;
  ahead?: number | null;
  behind?: number | null;
}

export interface ObjectDifference {
  id: string;
  label: string;
  expected: string | null;
  actual: string | null;
  status: "unchanged" | "changed" | "missing" | "unmanaged";
}
