import type { RepositoryRequest } from "@/lib/versioning/types";
import { invoke, isReadOnlyActive, READ_ONLY_MESSAGE } from "./core";

export function versioningRepository<T>(request: RepositoryRequest): Promise<T> {
  return invoke("versioning_repository", { request });
}

export function versioningOracleTimeout(txId: string, milliseconds: number): Promise<void> {
  return invoke("versioning_oracle_timeout", { txId, milliseconds });
}

export function versioningMetadata<T>(
  txId: string,
  operation: string,
  schema: string,
  name: string,
): Promise<T> {
  return invoke("versioning_metadata", { txId, operation, schema, name });
}

export function versioningControl<T>(request: Record<string, unknown>): Promise<T> {
  const connection = request.connection as
    | { connectionString?: string; readOnly?: boolean }
    | undefined;
  if (
    !["policy", "journal"].includes(String(request.action)) &&
    (connection?.readOnly || isReadOnlyActive(connection?.connectionString))
  )
    return Promise.reject(new Error(READ_ONLY_MESSAGE));
  return invoke("versioning_control", { request });
}

export interface VersioningRunStatus {
  id: string;
  targetId: string;
  status: "running" | "succeeded" | "failed";
  release: string;
  error: string | null;
}

export function versioningRun(request: Record<string, unknown>): Promise<string> {
  const connection = request.connection as
    | { connectionString?: string; readOnly?: boolean }
    | undefined;
  if (connection?.readOnly || isReadOnlyActive(connection?.connectionString))
    return Promise.reject(new Error(READ_ONLY_MESSAGE));
  return invoke("versioning_run", { request });
}

export function versioningRunStatus(id: string): Promise<VersioningRunStatus> {
  return invoke("versioning_run_status", { id });
}

export function versioningRunFleet(requests: Record<string, unknown>[]): Promise<string> {
  for (const request of requests) {
    const connection = request.connection as
      | { connectionString?: string; readOnly?: boolean }
      | undefined;
    if (connection?.readOnly || isReadOnlyActive(connection?.connectionString))
      return Promise.reject(new Error(READ_ONLY_MESSAGE));
  }
  return invoke("versioning_run_fleet", { requests });
}
