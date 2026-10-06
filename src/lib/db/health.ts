import { invoke } from "@tauri-apps/api/core";
import type { DatabaseKind } from "./providers";

export type HealthSeverity = "info" | "warning" | "critical";
export type HealthCategory = "security" | "performance" | "schema";
export type HealthCheckStatus = "issue" | "ok" | "skipped";

export interface HealthObject {
  name: string;
  detail: string | null;
  fixSql: string | null;
}

export interface HealthCheckResult {
  id: string;
  category: HealthCategory;
  title: string;
  explanation: string;
  status: HealthCheckStatus;
  severity: HealthSeverity | null;
  objects: HealthObject[];
  fixSql: string | null;
  skippedReason: string | null;
}

export interface HealthReport {
  checks: HealthCheckResult[];
  durationMs: number;
}

export function runDatabaseHealthChecks(
  kind: DatabaseKind,
  connectionString: string,
  database?: string,
): Promise<HealthReport> {
  return invoke("run_database_health_checks", { kind, connectionString, database });
}
