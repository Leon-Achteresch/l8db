import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { redisCellEditCommand } from "@/lib/redis-commands";
import { effectiveConnectionString } from "@/lib/ssh";

export function useRedisRowEdit() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useCallback(
    async (
      _id: string,
      updates: Record<string, string | null>,
      oldValues: Record<string, unknown>,
    ) => {
      if (connection?.readOnly) throw Error("Diese Verbindung ist schreibgeschützt.");
      if (!connection) throw Error("Keine aktive Verbindung.");
      const command = redisCellEditCommand(oldValues, updates);
      if (!command) return;
      const response = await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        command,
        database ?? undefined,
      );
      if (command.startsWith("RENAMENX ") && response.rows[0]?.result === 0)
        throw Error("Der Ziel-Key existiert bereits. Es wurde nichts überschrieben.");
      if (command.startsWith("EXPIRE ") && response.rows[0]?.result === 0)
        throw Error("Der Key existiert nicht mehr. Bitte aktualisieren.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["rows", connection.id, database] }),
        queryClient.invalidateQueries({ queryKey: ["count", connection.id, database] }),
      ]);
    },
    [connection, database, queryClient],
  );
}
