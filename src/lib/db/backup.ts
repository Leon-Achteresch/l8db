import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

export interface BackupToolCandidate {
  path: string;
  version: string | null;
}

export interface BackupToolInfo {
  name: string;
  path: string | null;
  version: string | null;
  major: number | null;
  banner: string | null;
  custom: boolean;
  candidates: BackupToolCandidate[];
  error: string | null;
}

export interface BackupProbe {
  tools: BackupToolInfo[];
  serverVersion: string | null;
  warnings: string[];
  installHint: string | null;
  searchDirs: string[];
}

export type BackupContent = "all" | "schema" | "data";

export interface BackupOptions {
  format: string;
  content: BackupContent;
  includeSchemas: string[];
  excludeSchemas: string[];
  includeTables: string[];
  excludeTables: string[];
  clean: boolean;
  ifExists: boolean;
  noOwner: boolean;
  noPrivileges: boolean;
  jobs: number | null;
  singleTransaction: boolean;
  routines: boolean;
  triggers: boolean;
  events: boolean;
  gzip: boolean;
  copyOnly: boolean;
  compression: boolean;
  exitOnError: boolean;
  drop: boolean;
  replace: boolean;
  closeConnections: boolean;
  sourceDatabase: string | null;
}

export interface BackupRequest {
  path: string;
  options: BackupOptions;
  toolPaths: Record<string, string>;
}

export interface BackupOutcome {
  path: string;
  format: string;
  command: string;
  bytes: number | null;
  durationMs: number;
  logTail: string[];
}

export interface BackupLogEvent {
  jobId: string | null;
  lines: string[];
}

export interface BackupProgressEvent {
  jobId: string | null;
  done: number;
  total: number;
}

export function backupProbe(
  kind: DatabaseKind,
  connectionString: string,
  database: string | undefined,
  toolPaths: Record<string, string>,
): Promise<BackupProbe> {
  return invoke("backup_probe", { kind, connectionString, database, toolPaths });
}

export function runBackup(
  kind: DatabaseKind,
  connectionString: string,
  database: string | undefined,
  request: BackupRequest,
  jobId: string,
): Promise<BackupOutcome> {
  return invoke("run_backup", {
    kind,
    connectionString,
    database,
    request,
    options: { jobId },
  });
}

export function runRestore(
  kind: DatabaseKind,
  connectionString: string,
  database: string | undefined,
  request: BackupRequest,
  jobId: string,
): Promise<BackupOutcome> {
  return invoke("run_restore", {
    kind,
    connectionString,
    database,
    request,
    options: { jobId },
  });
}
