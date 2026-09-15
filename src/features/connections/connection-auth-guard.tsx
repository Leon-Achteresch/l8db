import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { connectionError, isAuthFailure } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { ensurePassword } from "@/lib/password-prompt";
import { isConnectionQuery } from "@/lib/query-client";
import { activateConnection, activateConnectionWithToast } from "@/lib/ssh";

let recoveringId: string | null = null;

export function ConnectionAuthGuard() {
  const connection = useActiveConnection();
  const queryClient = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const connectionId = connection?.id ?? null;

  useEffect(() => {
    setError(null);
    if (!connectionId) return;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated" || event.action.type !== "error") return;
      if (!isConnectionQuery(event.query.queryKey, connectionId)) return;
      if (isAuthFailure(event.action.error)) setError(event.action.error);
    });
  }, [queryClient, connectionId]);

  useEffect(() => {
    if (!connection || !error || !isAuthFailure(error)) return;
    const id = connection.id;
    if (recoveringId === id) return;
    recoveringId = id;
    const label = connection.name;
    void (async () => {
      try {
        if (
          !(await ensurePassword(
            id,
            `Anmeldung bei „${label}“ fehlgeschlagen (${connectionError(error)}). Passwort erneut eingeben.`,
          ))
        ) {
          if (useConnectionsStore.getState().activeId === id) await activateConnection(null);
          return;
        }
        if (await activateConnectionWithToast(id)) {
          await queryClient.resetQueries({
            predicate: (query) => isConnectionQuery(query.queryKey, id),
          });
        }
      } finally {
        if (recoveringId === id) recoveringId = null;
      }
    })();
  }, [connection, error, queryClient]);

  return null;
}
