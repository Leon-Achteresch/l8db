import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import type { QueryResult } from "@/lib/db/types";
import { supports } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { schemaScopedConnectionString } from "@/lib/schema-scoped-url";
import { runsOneStatementPerCall, splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { MultiTargetCancelled, MultiTargetStatementError } from "./limiter";
import type { MultiTarget, MultiTargetExecutor } from "./run";

export { schemaScopedConnectionString };

export function targetConnectionString(connection: SavedConnection, target: MultiTarget): string {
  const base = effectiveConnectionString(connection);
  if (!target.schema) return base;
  if (!supports(connection, "multi_target_schemas"))
    throw new Error("Schemas als Ziel werden für diese Datenbankfamilie nicht unterstützt.");
  return schemaScopedConnectionString(base, target.schema);
}

export function targetStatements(sql: string, kind: SavedConnection["kind"]): string[] {
  if (!runsOneStatementPerCall(kind)) return [sql];
  const statements = splitSqlStatements(sql, kind).statements.map((statement) => statement.text);
  return statements.length ? statements : [sql];
}

function combine(results: QueryResult[]): QueryResult {
  const last = [...results].reverse().find((result) => result.columns.length > 0) ?? results.at(-1);
  if (!last) return { columns: [], rows: [], rows_affected: null, execution_time_ms: 0 };
  const affected = results
    .map((result) => result.rows_affected)
    .filter((value): value is number => typeof value === "number");
  return {
    ...last,
    rows_affected: affected.length ? affected.reduce((sum, value) => sum + value, 0) : null,
    execution_time_ms: results.reduce((sum, result) => sum + result.execution_time_ms, 0),
  };
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
      const url = targetConnectionString(connection, target);
      const statements = targetStatements(sql, connection.kind);
      const split = statements.length > 1;
      const results: QueryResult[] = [];
      for (const [index, statement] of statements.entries()) {
        const partial = { applied: index, total: statements.length };
        if (signal?.aborted) throw new MultiTargetCancelled(index > 0 ? partial : null);
        try {
          results.push(
            await executeQuery(connection.kind, url, statement, target.database ?? undefined, {
              jobId,
              confirmed: true,
              track: false,
              pooled: !write && !split,
              queryTimeout: timeoutSeconds,
              maxRows,
              connectionId: connection.id,
              ...(split ? { session: jobId } : {}),
            }),
          );
        } catch (error) {
          if (index === 0) throw error;
          throw new MultiTargetStatementError(
            error instanceof Error ? error.message : String(error),
            partial,
          );
        }
      }
      return combine(results);
    },
    canCancel: (target) => {
      const connection = useConnectionsStore
        .getState()
        .connections.find((entry) => entry.id === target.connectionId);
      return supports(connection, "query_cancel");
    },
    cancel: async (target, jobId) => {
      const connection = useConnectionsStore
        .getState()
        .connections.find((entry) => entry.id === target.connectionId);
      if (!supports(connection, "query_cancel")) return false;
      return cancelExecution(jobId);
    },
  };
}
