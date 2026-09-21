import type { CompareSideSelection } from "@/lib/compare-types";

export type VersioningKind = "postgres" | "oracle";

export interface ManagedObject {
  id: string;
  path: string;
  bodyPath?: string;
  metadataVersion?: 2;
  selection: Omit<CompareSideSelection, "connectionId" | "database">;
}

export interface VersioningProject {
  format: 1;
  id: string;
  name: string;
  kind: VersioningKind;
  objects: ManagedObject[];
}

export interface ObjectSnapshot {
  object: ManagedObject;
  definition: string;
  checksum: string;
}

export interface ReleaseMigration {
  id: string;
  title: string;
  sql: string;
  checksum: string;
}

export interface DatabaseRelease {
  format: 1;
  id: string;
  projectId: string;
  kind: VersioningKind;
  parent: string | null;
  createdAt: string;
  objects: ObjectSnapshot[];
  migrations: ReleaseMigration[];
  track?: string;
  safety?: ReleaseSafety;
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

export interface DatabaseTarget {
  id: string;
  name: string;
  connectionId: string;
  database: string | null;
  production: boolean;
  schema?: string | null;
  release: ReleaseReference | null;
  history: DeploymentEvent[];
  track?: string;
  pinnedRelease?: string | null;
  paused?: boolean;
  ledgerSchema?: string;
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
    | "fetch"
    | "pull"
    | "push"
    | "init"
    | "status"
    | "files"
    | "read"
    | "write"
    | "delete"
    | "diff"
    | "commit"
    | "branch"
    | "checkout"
    | "local-read"
    | "local-write"
    | "merge";
  repo: string;
  path?: string;
  content?: string;
  expected?: string | null;
  revision?: string;
  name?: string;
  paths?: string[];
  base?: string;
  incoming?: string;
}

export interface ObjectDifference {
  id: string;
  label: string;
  expected: string | null;
  actual: string | null;
  status: "unchanged" | "changed" | "missing" | "unmanaged";
}
