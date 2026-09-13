import type { SavedConnection } from "@/lib/connections";
import { insertRowInTransaction } from "@/lib/db";
import { ensureManagedTransaction, runManagedOperation } from "@/lib/managed-transactions";
import { supports } from "@/lib/providers";
import { finishTask, startTask, updateTask } from "@/lib/tasks";
import { useTransactionStore } from "@/lib/transactions";

export async function pasteRows(
  connection: SavedConnection,
  database: string | null,
  schema: string,
  table: string,
  rows: Record<string, string | null>[],
) {
  if (
    connection.readOnly ||
    !supports(connection, "row_edit") ||
    !supports(connection, "transactions")
  )
    throw new Error("Einfügen ist für dieses Ziel nicht verfügbar.");
  if (!rows.length || rows.length > 1000) throw new Error("Bitte 1 bis 1000 Zeilen einfügen.");
  const tx = await ensureManagedTransaction(connection, database, { type: "table", schema, table });
  useTransactionStore.getState().setPanelOpen(true);
  let stopped = false;
  let inserted = 0;
  const job = startTask(
    {
      title: `Tabellenblock einfügen · ${schema}.${table}`,
      connectionId: connection.id,
      connectionName: connection.name,
      database,
      total: rows.length,
    },
    async () => {
      stopped = true;
    },
  );
  try {
    await runManagedOperation(tx.txId, async () => {
      for (const values of rows) {
        if (stopped)
          throw new Error(
            "Einfügen vom Benutzer abgebrochen. Bereits eingefügte Zeilen liegen in der offenen Transaktion; bitte prüfen oder Rollback ausführen.",
          );
        const row = await insertRowInTransaction(tx.txId, schema, table, values);
        inserted++;
        useTransactionStore.getState().addChange(tx.txId, {
          id: crypto.randomUUID(),
          timestamp: Date.now(),
          type: "insert",
          schema,
          table,
          rowValues: row,
        });
        updateTask(job, {
          progress: inserted,
          detail: "Noch nicht committet. Nach Abschluss im Transaktionspanel prüfen.",
        });
      }
    });
    updateTask(job, {
      detail: "Einfügen abgeschlossen. Commit oder Rollback erfolgt separat im Transaktionspanel.",
    });
    finishTask(job, { inserted, txId: tx.txId });
    return inserted;
  } catch (failure) {
    const error = `${String(failure)}\n${inserted} Zeilen eingefügt, kein automatischer Commit. Transaktion prüfen und gegebenenfalls vollständig zurückrollen.`;
    finishTask(job, { inserted, txId: tx.txId }, error);
    throw new Error(error);
  }
}
