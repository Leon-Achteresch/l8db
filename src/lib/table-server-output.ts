import { toast } from "sonner";
import type { SavedConnection } from "./connections";
import { transactionServerOutput } from "./db";
import { supports } from "./providers";
import { deliverServerOutput } from "./server-output";

export async function withTableServerOutput<T>(
  connection: SavedConnection,
  database: string | null,
  txId: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } finally {
    if (supports(connection, "server_output")) {
      await transactionServerOutput(txId)
        .then((messages) => deliverServerOutput(connection.id, database, messages))
        .catch(() => {
          try {
            toast.warning("Server-Ausgabe konnte nicht gelesen werden.", {
              id: `table-output:${connection.id}`,
            });
          } catch {
            return;
          }
        });
    }
  }
}
