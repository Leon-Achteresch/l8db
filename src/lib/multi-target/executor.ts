import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import { supports } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { schemaScopedConnectionString } from "@/lib/schema-scoped-url";
import { effectiveConnectionString } from "@/lib/ssh";
import { MultiTargetCancelled } from "./limiter";
import type { MultiTarget, MultiTargetExecutor } from "./run";

export { schemaScopedConnectionString };

export function targetConnectionString(connection: SavedConnection, target: MultiTarget): string {
  const base = effectiveConnectionString(connection);
  if (!target.schema) return base;
  if (!supports(connection, "multi_target_schemas"))
    throw new Error("Schemas als Ziel werden für diese Datenbankfamilie nicht unterstützt.");
  return schemaScopedConnectionString(base, target.schema);
}

export function multiTargetExecutor(
  write: boolean,
  prepare: (connectionId: string) => Promise<SavedConnection> = prepareConnection,
): MultiTargetExecutor {
  const prepared = new Map<string, Promise<SavedConnection>>();
  const ready = (connectionId: string) => {
    let pending = prepared.get(connectionId);
    if (!pending) {
      pending = prepare(connectionId);
      prepared.set(connectionId, pending);
    }
    return pending;
  };
  return {
    execute: async ({ target, sql, jobId, timeoutSeconds, maxRows, signal }) => {
      const connection = await ready(target.connectionId);
      if (signal?.aborted) throw new MultiTargetCancelled();
      return executeQuery(
        connection.kind,
        targetConnectionString(connection, target),
        sql,
        target.database ?? undefined,
        {
          jobId,
          confirmed: true,
          track: false,
          pooled: !write,
          queryTimeout: timeoutSeconds,
          maxRows,
          connectionId: connection.id,
        },
      );
    },
    cancel: async (target, jobId) => {
      const connection = useConnectionsStore
        .getState()
        .connections.find((entry) => entry.id === target.connectionId);
      if (!supports(connection, "query_cancel")) return false;
      return cancelExecution(jobId).catch(() => false);
    },
  };
}
