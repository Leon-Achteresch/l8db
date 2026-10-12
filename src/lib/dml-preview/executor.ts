import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { previewDml } from "@/lib/db/dml-preview";
import { supports } from "@/lib/providers";
import { isServerOutputEnabled } from "@/lib/server-output";
import { expandSessionViews, sessionViewsFor } from "@/lib/session-views";
import { effectiveConnectionString } from "@/lib/ssh";
import { getQueryTransaction } from "@/lib/transactions";
import type { DmlPreviewExecutor } from "./run";

export const COMMITTED_STATE_NOTE =
  "Vorschau basiert auf dem festgeschriebenen Stand; ungespeicherte Änderungen deiner offenen Transaktion sind nicht berücksichtigt.";

export function previewNote(connection: SavedConnection, database: string | null): string | null {
  if (getQueryTransaction(connection.id, database)) return COMMITTED_STATE_NOTE;
  if (supports(connection, "server_output") && isServerOutputEnabled(connection.id))
    return COMMITTED_STATE_NOTE;
  return null;
}

export function dmlPreviewExecutor(
  connection: SavedConnection,
  database: string | null,
  timeoutSeconds: number,
): DmlPreviewExecutor {
  const views = sessionViewsFor(connection.id, database);
  const expand = (sql: string) => expandSessionViews(sql, views, connection.kind);
  return {
    note: previewNote(connection, database),
    preview: (plan, jobId) =>
      previewDml(
        connection.kind,
        effectiveConnectionString(connection),
        database ?? undefined,
        { countSql: expand(plan.countSql), sampleSql: expand(plan.sampleSql), limit: plan.limit },
        { jobId, queryTimeout: timeoutSeconds, connectionId: connection.id },
      ),
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
}
