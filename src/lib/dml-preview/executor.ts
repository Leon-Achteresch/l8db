import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import { executeInTransaction } from "@/lib/db/transactions";
import { runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { schemaScopedConnectionString } from "@/lib/schema-scoped-url";
import { useServerOutputStore } from "@/lib/server-output";
import { expandSessionViews, sessionViewsFor } from "@/lib/session-views";
import { effectiveConnectionString } from "@/lib/ssh";
import { type TransactionSavepoint, transactionSavepoint } from "@/lib/transaction-sql-changes";
import { getQueryTransaction } from "@/lib/transactions";
import type { DmlPreviewExecutor } from "./run";
import { editorSearchPath } from "./search-path";

export const OUTSIDE_TRANSACTION_NOTE =
  "Die Vorschau läuft außerhalb der offenen Transaktion und sieht deren noch nicht festgeschriebene Änderungen nicht.";

export function previewSavepoint(kind: SavedConnection["kind"]): TransactionSavepoint | null {
  return transactionSavepoint(kind, "l8db_preview");
}

export function previewConnectionString(connection: SavedConnection, database: string | null) {
  const url = effectiveConnectionString(connection);
  if (!supports(connection, "multi_target_schemas")) return url;
  if (!useServerOutputStore.getState().enabled[connection.id]) return url;
  const path = editorSearchPath(connection.id, database);
  return path ? schemaScopedConnectionString(url, path) : url;
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
  let txId: string | null = null;
  let savepoint: TransactionSavepoint | null = null;
  let opening = false;
  const internal = (id: string, sql: string, jobId: string = crypto.randomUUID()) =>
    runManagedOperation(id, () => executeInTransaction(id, sql, options(jobId)), {
      recordError: false,
    });
  const stillOpen = (id: string) => getQueryTransaction(connection.id, database)?.txId === id;
  const executor: DmlPreviewExecutor = {
    note: null,
    holdsTransaction: () => opening || savepoint !== null,
    open: async () => {
      const transaction = getQueryTransaction(connection.id, database);
      if (!transaction) return;
      const statements = previewSavepoint(connection.kind);
      if (!statements) {
        executor.note = OUTSIDE_TRANSACTION_NOTE;
        return;
      }
      opening = true;
      try {
        await internal(transaction.txId, statements.begin);
        txId = transaction.txId;
        savepoint = statements;
      } catch {
        executor.note = OUTSIDE_TRANSACTION_NOTE;
      } finally {
        opening = false;
      }
    },
    close: async (failed) => {
      const id = txId;
      const statements = savepoint;
      txId = null;
      savepoint = null;
      if (!id || !statements || !stillOpen(id)) return;
      if (failed) await internal(id, statements.rollback).catch(() => undefined);
      if (statements.release) await internal(id, statements.release).catch(() => undefined);
    },
    execute: (sql, jobId) => {
      if (txId && savepoint && !stillOpen(txId)) {
        txId = null;
        savepoint = null;
        executor.note = OUTSIDE_TRANSACTION_NOTE;
      }
      if (txId && savepoint) return internal(txId, expand(sql), jobId);
      return executeQuery(
        connection.kind,
        previewConnectionString(connection, database),
        expand(sql),
        database ?? undefined,
        { ...options(jobId), pooled: true },
      );
    },
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
  return executor;
}
