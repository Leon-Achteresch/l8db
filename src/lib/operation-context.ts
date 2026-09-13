import { useConnectionsStore } from "@/lib/connections";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTransactionStore } from "@/lib/transactions";

export function operationContext(args: Record<string, unknown>) {
  const tx = useTransactionStore.getState().transactions.find((entry) => entry.txId === args.txId);
  const connection = useConnectionsStore.getState().connections.find((entry) => {
    if (tx) return entry.id === tx.connectionId;
    try {
      return effectiveConnectionString(entry) === args.connectionString;
    } catch {
      return false;
    }
  });
  return {
    connectionId: connection?.id,
    connectionName: connection?.name ?? "Datenbankverbindung",
    database: typeof args.database === "string" ? args.database : (tx?.database ?? null),
    kind: connection?.kind ?? (typeof args.kind === "string" ? args.kind : undefined),
  };
}
