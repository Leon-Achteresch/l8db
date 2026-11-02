import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { listSchemas } from "@/lib/db/catalog";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import { prepareConnection } from "@/lib/prepare-connection";
import { supports } from "@/lib/providers";
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

interface Preparation {
  promise: Promise<SavedConnection>;
  controller: AbortController;
  waiting: number;
  settled: boolean;
}

export function multiTargetExecutor(
  write: boolean,
  prepare: (
    connectionId: string,
    signal: AbortSignal,
  ) => Promise<SavedConnection> = prepareConnection,
): MultiTargetExecutor {
  const prepared = new Map<string, Preparation>();
  const ready = (connectionId: string, signal?: AbortSignal): Promise<SavedConnection> => {
    if (signal?.aborted) return Promise.reject(new MultiTargetCancelled());
    let entry = prepared.get(connectionId);
    if (!entry) {
      const controller = new AbortController();
      const created: Preparation = {
        promise: prepare(connectionId, controller.signal),
        controller,
        waiting: 0,
        settled: false,
      };
      const settle = () => {
        created.settled = true;
      };
      created.promise.then(settle, settle);
      prepared.set(connectionId, created);
      entry = created;
    }
    const current = entry;
    current.waiting++;
    if (!signal) return current.promise;
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        current.waiting--;
        if (current.waiting === 0 && !current.settled) {
          current.controller.abort();
          if (prepared.get(connectionId) === current) prepared.delete(connectionId);
        }
        reject(new MultiTargetCancelled());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      current.promise.then(resolve, reject).finally(() => {
        signal.removeEventListener("abort", onAbort);
      });
    });
  };
  return {
    execute: async ({
      target,
      sql,
      jobId,
      timeoutSeconds,
      maxRows,
      signal,
      onExecuting,
      preflight,
    }) => {
      const connection = await ready(target.connectionId, signal);
      if (signal?.aborted) throw new MultiTargetCancelled();
      const url = targetConnectionString(connection, target);
      if (preflight) {
        await listSchemas(connection.kind, url, target.database ?? undefined);
        if (signal?.aborted) throw new MultiTargetCancelled();
      }
      onExecuting?.();
      return executeQuery(connection.kind, url, sql, target.database ?? undefined, {
        jobId,
        confirmed: true,
        track: false,
        pooled: !write,
        queryTimeout: timeoutSeconds,
        maxRows,
        connectionId: connection.id,
      });
    },
    canCancel: (target) =>
      supports(
        useConnectionsStore
          .getState()
          .connections.find((entry) => entry.id === target.connectionId),
        "query_cancel",
      ),
    cancel: async (target, jobId) => {
      const connection = useConnectionsStore
        .getState()
        .connections.find((entry) => entry.id === target.connectionId);
      if (!supports(connection, "query_cancel")) return false;
      return cancelExecution(jobId).catch(() => false);
    },
  };
}
