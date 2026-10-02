import { useConnectionsStore } from "@/lib/connections/store";
import {
  beginTransaction,
  commitTransaction,
  confirmSqlExecution,
  type DatabaseKind,
  executeInTransaction,
  executeQuery,
  rollbackTransaction,
} from "@/lib/db";
import { productionWriteBlock } from "@/lib/environments";
import { operationContext } from "@/lib/operation-context";

export interface TriggerReplacement {
  kind: DatabaseKind;
  connectionString: string;
  database?: string;
  schema: string;
  table: string;
  trigger: string;
  original: string;
  definition: string;
}

export function triggerDropSql(
  kind: DatabaseKind | undefined,
  schema: string,
  table: string,
  trigger: string,
): string {
  const q = (v: string) => `"${v.replace(/"/g, '""')}"`;
  switch (kind) {
    case "postgres":
      return `DROP TRIGGER IF EXISTS ${q(trigger)} ON ${q(schema)}.${q(table)};\n`;
    case "sqlite":
      return `DROP TRIGGER IF EXISTS ${q(schema)}.${q(trigger)};\n`;
    case "mysql":
      return `DROP TRIGGER IF EXISTS \`${schema.replace(/`/g, "``")}\`.\`${trigger.replace(/`/g, "``")}\`;\n`;
    default:
      return "";
  }
}

export function triggerErrorPrefix(kind: DatabaseKind | undefined, drop: string): string {
  return kind === "mysql" || kind === "sqlite" ? "" : drop;
}

export async function replaceTrigger(r: TriggerReplacement): Promise<number> {
  const drop = triggerDropSql(r.kind, r.schema, r.table, r.trigger);
  const started = performance.now();
  if (!drop || r.kind === "postgres") {
    const result = await executeQuery(
      r.kind,
      r.connectionString,
      `${drop}${r.definition}`,
      r.database,
    );
    return result.execution_time_ms;
  }
  const { connectionId } = operationContext({
    kind: r.kind,
    connectionString: r.connectionString,
    database: r.database,
  });
  const connection = useConnectionsStore
    .getState()
    .connections.find((entry) => entry.id === connectionId);
  const blocked = productionWriteBlock(connection, `${drop}${r.definition}`);
  if (blocked) throw new Error(blocked);
  await confirmSqlExecution(r.kind, r.connectionString, `${drop}${r.definition}`, r.database);
  const options = { confirmed: true };
  if (r.kind === "sqlite") {
    const tx = await beginTransaction(r.kind, r.connectionString, r.database);
    try {
      await executeInTransaction(tx, drop, options);
      await executeInTransaction(tx, r.definition, options);
      await commitTransaction(tx);
    } catch (error) {
      try {
        await rollbackTransaction(tx);
      } catch (rollbackError) {
        throw new Error(`${String(error)}\nRollback fehlgeschlagen: ${String(rollbackError)}`);
      }
      throw error;
    }
    return Math.round(performance.now() - started);
  }
  await executeQuery(r.kind, r.connectionString, drop, r.database, options);
  try {
    await executeQuery(r.kind, r.connectionString, r.definition, r.database, options);
  } catch (error) {
    try {
      await executeQuery(r.kind, r.connectionString, r.original, r.database, options);
    } catch (restoreError) {
      throw new Error(
        `${String(error)}\nDer ursprüngliche Trigger konnte nicht wiederhergestellt werden: ${String(restoreError)}\nUrsprüngliche Definition:\n${r.original}`,
      );
    }
    throw error;
  }
  return Math.round(performance.now() - started);
}
