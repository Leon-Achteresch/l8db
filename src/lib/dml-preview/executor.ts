import type { SavedConnection } from "@/lib/connections";
import { cancelExecution } from "@/lib/db/core";
import { executeQuery } from "@/lib/db/rows";
import { executeInTransaction } from "@/lib/db/transactions";
import { runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";
import { getQueryTransaction } from "@/lib/transactions";
import type { DmlPreviewExecutor } from "./run";

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
  });
  return {
    execute: (sql, jobId) => {
      const transaction = getQueryTransaction(connection.id, database);
      if (transaction)
        return runManagedOperation(transaction.txId, () =>
          executeInTransaction(transaction.txId, sql, options(jobId)),
        );
      return executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
        { ...options(jobId), pooled: true },
      );
    },
    cancel: (jobId) =>
      supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false),
  };
}
