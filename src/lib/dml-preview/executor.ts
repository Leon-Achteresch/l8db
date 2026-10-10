import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import { executeInTransaction } from "@/lib/db/transactions";
import { markTransactionAborted, runManagedOperation } from "@/lib/managed-transactions";
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

export const TRANSACTION_ABORTED_REASON =
  "Die Vorschau konnte ihren Sicherungspunkt nicht zurückrollen. Die Transaktion ist abgebrochen: Bitte zurückrollen. Ein Commit ist nicht mehr möglich.";
export const EDITOR_SESSION_ABORTED_REASON =
  "Die Vorschau konnte ihren Sicherungspunkt nicht zurückrollen. Die Transaktion der Editor-Sitzung ist abgebrochen: Bitte ROLLBACK ausführen.";

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
  if (supports(connection, "editor_session_preview") && isServerOutputEnabled(connection.id))
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
    cancelMode: "statement" as const,
  });
  const views = sessionViewsFor(connection.id, database);
  const expand = (sql: string) => expandSessionViews(sql, views, connection.kind);
  let txId: string | null = null;
  let session: PreviewSession = "pooled";
  let savepoint: TransactionSavepoint | null = null;
  let holding = false;
  let inFlight = 0;

  const send = async (sql: string, jobId: string = crypto.randomUUID()) => {
    const shared = session !== "pooled";
    if (shared) inFlight++;
    try {
      if (session === "transaction" && txId) {
        const id = txId;
        return await runManagedOperation(id, () => executeInTransaction(id, sql, options(jobId)), {
          recordError: false,
        });
      }
      return await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
        session === "pooled" ? { ...options(jobId), pooled: true } : options(jobId),
      );
    } finally {
      if (shared) inFlight--;
    }
  };
  const transactionGone = () =>
    session === "transaction" && getQueryTransaction(connection.id, database)?.txId !== txId;

  const executor: DmlPreviewExecutor = {
    note: null,
    holdsSession: () => holding || inFlight > 0,
    open: async () => {
      session = previewSession(connection, database);
      txId =
        session === "transaction"
          ? (getQueryTransaction(connection.id, database)?.txId ?? null)
          : null;
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
        try {
          if (failed) await send(statements.rollback);
          if (statements.release) await send(statements.release);
        } catch (error) {
          const reason =
            session === "transaction" ? TRANSACTION_ABORTED_REASON : EDITOR_SESSION_ABORTED_REASON;
          if (session === "transaction" && txId) markTransactionAborted(txId, reason);
          throw new Error(`${reason} (${error instanceof Error ? error.message : String(error)})`);
        }
      } finally {
        savepoint = null;
        holding = false;
      }
    },
    execute: (sql, jobId) => {
      if (transactionGone()) {
        session = "pooled";
        savepoint = null;
        holding = false;
        executor.note = OUTSIDE_TRANSACTION_NOTE;
      }
      return send(expand(sql), jobId);
    },
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
  return executor;
}
