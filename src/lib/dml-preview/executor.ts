import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import type { DatabaseKind } from "@/lib/db/providers";
import { executeQuery } from "@/lib/db/rows";
import { executeInTransaction } from "@/lib/db/transactions";
import { runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { expandSessionViews, sessionViewsFor } from "@/lib/session-views";
import { effectiveConnectionString } from "@/lib/ssh";
import { getQueryTransaction } from "@/lib/transactions";
import type { DmlPreviewExecutor } from "./run";

const SAVEPOINT = "l8db_preview";

export const OUTSIDE_TRANSACTION_NOTE =
  "Die Vorschau läuft außerhalb der offenen Transaktion und sieht deren noch nicht festgeschriebene Änderungen nicht.";

export interface PreviewSavepoint {
  begin: string;
  rollback: string;
  release: string | null;
}

export function previewSavepoint(kind: DatabaseKind): PreviewSavepoint | null {
  if (["postgres", "mysql", "sqlite", "sqlite_http", "duckdb"].includes(kind))
    return {
      begin: `SAVEPOINT ${SAVEPOINT}`,
      rollback: `ROLLBACK TO SAVEPOINT ${SAVEPOINT}`,
      release: `RELEASE SAVEPOINT ${SAVEPOINT}`,
    };
  if (kind === "oracle")
    return {
      begin: `SAVEPOINT ${SAVEPOINT}`,
      rollback: `ROLLBACK TO SAVEPOINT ${SAVEPOINT}`,
      release: null,
    };
  if (kind === "mssql")
    return {
      begin: `SAVE TRANSACTION ${SAVEPOINT}`,
      rollback: `ROLLBACK TRANSACTION ${SAVEPOINT}`,
      release: null,
    };
  return null;
}

export function dmlPreviewExecutor(
  connection: SavedConnection,
  database: string | null,
  timeoutSeconds: number,
): DmlPreviewExecutor {
  const options = (jobId: string) => ({
    jobId,
    confirmed: true,
    track: false,
    queryTimeout: timeoutSeconds,
    connectionId: connection.id,
  });
  const views = sessionViewsFor(connection.id, database);
  const expand = (sql: string) => expandSessionViews(sql, views, connection.kind);
  const transaction = getQueryTransaction(connection.id, database);
  const savepoint = transaction ? previewSavepoint(connection.kind) : null;
  let inTransaction = Boolean(transaction && savepoint);
  const inTx = (sql: string) =>
    transaction
      ? runManagedOperation(transaction.txId, () =>
          executeInTransaction(transaction.txId, sql, options(crypto.randomUUID())),
        )
      : Promise.reject(new Error("Keine Transaktion offen."));
  const executor: DmlPreviewExecutor = {
    note: transaction && !savepoint ? OUTSIDE_TRANSACTION_NOTE : null,
    open: async () => {
      if (!inTransaction || !savepoint) return;
      try {
        await inTx(savepoint.begin);
      } catch {
        inTransaction = false;
        executor.note = OUTSIDE_TRANSACTION_NOTE;
      }
    },
    close: async (failed) => {
      if (!inTransaction || !savepoint) return;
      if (failed) await inTx(savepoint.rollback).catch(() => undefined);
      if (savepoint.release) await inTx(savepoint.release).catch(() => undefined);
    },
    execute: (sql, jobId) => {
      if (inTransaction && transaction)
        return runManagedOperation(transaction.txId, () =>
          executeInTransaction(transaction.txId, expand(sql), options(jobId)),
        );
      return executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        expand(sql),
        database ?? undefined,
        options(jobId),
      );
    },
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
  return executor;
}
