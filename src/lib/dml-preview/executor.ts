import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { previewDml } from "@/lib/db/dml-preview";
import { supports } from "@/lib/providers";
import { isServerOutputEnabled } from "@/lib/server-output";
import { expandSessionViews, sessionViewsFor } from "@/lib/session-views";
import { writesData } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh";
import { getQueryTransaction } from "@/lib/transactions";
import { type DmlPreviewExecutor, DmlPreviewUnavailableError } from "./run";

export const COMMITTED_STATE_NOTE =
  "Vorschau basiert auf dem festgeschriebenen Stand; ungespeicherte Änderungen deiner offenen Transaktion sind nicht berücksichtigt.";
export const SESSION_VIEW_REASON =
  "Eine Sitzungsansicht macht die abgeleitete Abfrage mehrteilig oder schreibend. Die Vorschau wird nicht ausgeführt.";

export function previewNote(connection: SavedConnection, database: string | null): string | null {
  if (getQueryTransaction(connection.id, database)) return COMMITTED_STATE_NOTE;
  if (supports(connection, "server_output") && isServerOutputEnabled(connection.id))
    return COMMITTED_STATE_NOTE;
  return null;
}

export function safePreviewSql(sql: string, kind: SavedConnection["kind"]): string {
  if (writesData(sql, kind) || splitSqlStatements(sql, kind).statements.length !== 1)
    throw new DmlPreviewUnavailableError(SESSION_VIEW_REASON);
  return sql;
}

export function dmlPreviewExecutor(
  connection: SavedConnection,
  database: string | null,
  timeoutSeconds: number,
  lockTimeoutSeconds = timeoutSeconds,
): DmlPreviewExecutor {
  const views = sessionViewsFor(connection.id, database);
  const expand = (sql: string) =>
    safePreviewSql(expandSessionViews(sql, views, connection.kind), connection.kind);
  const note = previewNote(connection, database);
  const busy = note !== null;
  const shortTimeout = Math.min(timeoutSeconds, lockTimeoutSeconds);
  return {
    note,
    busy,
    preview: async (plan, jobId) =>
      previewDml(
        connection.kind,
        effectiveConnectionString(connection),
        database ?? undefined,
        {
          countSql: expand(plan.countSql),
          sampleSql: expand(plan.sampleSql),
          limit: plan.limit,
          ...(busy ? { lockTimeoutMs: shortTimeout * 1000 } : {}),
        },
        {
          jobId,
          queryTimeout: busy ? Math.min(timeoutSeconds, Math.max(5, shortTimeout)) : timeoutSeconds,
          connectionId: connection.id,
        },
      ),
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
}
