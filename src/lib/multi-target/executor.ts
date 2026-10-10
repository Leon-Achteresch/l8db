import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import type { QueryResult } from "@/lib/db/types";
import { supports } from "@/lib/providers";
import { prepareConnection } from "@/lib/schema-compare/store";
import { runsOneStatementPerCall, splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { MultiTargetCancelled } from "./limiter";
import type { MultiTarget, MultiTargetExecutor } from "./run";

const SCHEMA_KEYS = new Set(["schema", "search_path", "currentSchema"]);

function decodedKey(part: string): string {
  const key = part.split("=")[0];
  try {
    return decodeURIComponent(key);
  } catch {
    return key;
  }
}

export function schemaScopedConnectionString(connectionString: string, schema: string): string {
  const hashIndex = connectionString.indexOf("#");
  const base = hashIndex < 0 ? connectionString : connectionString.slice(0, hashIndex);
  const hash = hashIndex < 0 ? "" : connectionString.slice(hashIndex);
  const queryIndex = base.indexOf("?");
  const head = queryIndex < 0 ? base : base.slice(0, queryIndex);
  const params = queryIndex < 0 ? [] : base.slice(queryIndex + 1).split("&");
  const kept = params.filter((part) => part && !SCHEMA_KEYS.has(decodedKey(part)));
  kept.push(`schema=${encodeURIComponent(schema)}`);
  return `${head}?${kept.join("&")}${hash}`;
}

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
      const results: QueryResult[] = [];
      for (const [index, statement] of statements.entries()) {
        if (signal?.aborted && index > 0)
          throw new MultiTargetCancelled(
            `Abgebrochen nach ${index} von ${statements.length} Anweisungen; die bereits ausgeführten bleiben bestehen.`,
          );
        results.push(
          await executeQuery(connection.kind, url, statement, target.database ?? undefined, {
            jobId,
            confirmed: true,
            track: false,
            pooled: !write,
            queryTimeout: timeoutSeconds,
            maxRows,
            connectionId: connection.id,
          }),
        );
      }
      return combine(results);
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
