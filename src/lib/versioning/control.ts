import type { SavedConnection } from "@/lib/connections";
import { versioningControl } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import type { DatabaseTarget, VersioningProject } from "./types";

export interface SharedPolicy {
  track: string;
  pinnedRelease: string | null;
  paused: boolean;
  production: boolean;
  requireApproval: boolean;
  operators: string[];
  administrators: string[];
  reviewers: string[];
}

export interface PolicyRecord {
  revision: number;
  policy: SharedPolicy;
}

export interface JournalEntry {
  ENTRY_ID: string;
  RUN_ID: string;
  CREATED_AT: string;
  ACTOR: string;
  EVENT: string;
  BODY: string;
}

export function initialPolicy(target: DatabaseTarget): SharedPolicy {
  return {
    track: target.track ?? "main",
    pinnedRelease: target.pinnedRelease ?? null,
    paused: target.paused ?? false,
    production: target.production,
    requireApproval: false,
    operators: [],
    administrators: [],
    reviewers: [],
  };
}

export function control<T>(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
  action: string,
  options: Record<string, unknown> = {},
): Promise<T> {
  const schema = target.ledgerSchema || target.schema || project.objects[0]?.selection.schema;
  if (!schema) throw new Error("Verwaltetes Schema fehlt.");
  return versioningControl<T>({
    ...options,
    action,
    connection: {
      kind: connection.kind,
      connectionString: effectiveConnectionString(connection),
      database: target.database,
      schema,
      projectId: project.id,
      readOnly: connection.readOnly ?? false,
    },
  });
}

export async function sharedTarget(
  connection: SavedConnection,
  project: VersioningProject,
  target: DatabaseTarget,
) {
  const record = await control<PolicyRecord>(connection, project, target, "policy");
  return { target: { ...target, ...record.policy }, record };
}
