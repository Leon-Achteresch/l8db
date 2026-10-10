import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import { executeInTransaction } from "@/lib/db/transactions";
import { runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { isServerOutputEnabled } from "@/lib/server-output";
import { expandSessionViews, sessionViewsFor } from "@/lib/session-views";
import { effectiveConnectionString } from "@/lib/ssh";
import { type TransactionSavepoint, transactionSavepoint } from "@/lib/transaction-sql-changes";
import { getQueryTransaction } from "@/lib/transactions";
import type { DmlPreviewExecutor } from "./run";

export const OUTSIDE_TRANSACTION_NOTE =
  "Die Vorschau läuft außerhalb der offenen Transaktion und sieht deren noch nicht festgeschriebene Änderungen nicht.";

export type PreviewSession = "transaction" | "editor-session" | "pooled";

const AUTOCOMMIT_SAVEPOINT = /can only be used in transaction blocks|25P01/i;

export function previewSavepoint(kind: SavedConnection["kind"]): TransactionSavepoint | null {
  return transactionSavepoint(kind, "l8db_preview");
}

export function previewSession(
  connection: SavedConnection,
  database: string | null,
): PreviewSession {
  if (getQueryTransaction(connection.id, database) && previewSavepoint(connection.kind))
    return "transaction";
  if (connection.kind === "postgres" && isServerOutputEnabled(connection.id))
    return "editor-session";
  return "pooled";
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
  let session = previewSession(connection, database);
  let savepoint: TransactionSavepoint | null = null;
  let holding = false;

  const inTransaction = (sql: string, jobId: string = crypto.randomUUID()) => {
    const txId = transaction?.txId;
    if (!txId) return Promise.reject(new Error("Keine Transaktion offen."));
    return runManagedOperation(txId, () => executeInTransaction(txId, sql, options(jobId)), {
      recordError: false,
    });
  };
  const direct = (sql: string, jobId: string = crypto.randomUUID(), pooled = false) =>
    executeQuery(
      connection.kind,
      effectiveConnectionString(connection),
      sql,
      database ?? undefined,
      pooled ? { ...options(jobId), pooled: true } : options(jobId),
    );
  const send = (sql: string, jobId?: string) =>
    session === "transaction"
      ? inTransaction(sql, jobId)
      : direct(sql, jobId, session === "pooled");
  const transactionGone = () =>
    session === "transaction" &&
    getQueryTransaction(connection.id, database)?.txId !== transaction?.txId;

  const executor: DmlPreviewExecutor = {
    note: null,
    holdsTransaction: () => holding,
    open: async () => {
      if (session === "pooled") return;
      const statements = previewSavepoint(connection.kind);
      if (!statements) return;
      holding = true;
      try {
        await send(statements.begin);
        savepoint = statements;
      } catch (error) {
        holding = false;
        if (session === "editor-session" && AUTOCOMMIT_SAVEPOINT.test(String(error))) return;
        session = "pooled";
        executor.note = OUTSIDE_TRANSACTION_NOTE;
      }
    },
    close: async (failed) => {
      const statements = savepoint;
      try {
        if (!statements || transactionGone()) return;
        if (failed) await send(statements.rollback).catch(() => undefined);
        if (statements.release) await send(statements.release).catch(() => undefined);
      } finally {
        savepoint = null;
        holding = false;
      }
    },
    execute: (sql, jobId) => {
      if (transactionGone()) {
        session = "pooled";
        savepoint = null;
        executor.note = OUTSIDE_TRANSACTION_NOTE;
      }
      return send(expand(sql), jobId);
    },
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
  return executor;
}
