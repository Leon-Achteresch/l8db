import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { isAuthFailure } from "@/lib/connection-url";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { ensurePassword } from "@/lib/password-prompt";
import { useFunctionsQuery, useTablesQuery } from "@/lib/queries";
import { isConnectionQuery } from "@/lib/query-client";
import { activateConnection, activateConnectionWithToast } from "@/lib/ssh";

let recoveringId: string | null = null;

export function ConnectionAuthGuard() {
  const connection = useActiveConnection();
  const queryClient = useQueryClient();
  const { error: tablesError } = useTablesQuery();
  const { error: functionsError } = useFunctionsQuery();
  const error = tablesError ?? functionsError;

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
            `Anmeldung bei „${label}“ fehlgeschlagen. Passwort erneut eingeben.`,
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
