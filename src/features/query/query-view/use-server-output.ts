import { useCallback, useState } from "react";
import { toast } from "sonner";

import { collectServerOutput, toggleServerOutput, useServerOutputStore } from "@/lib/server-output";
import { effectiveConnectionString } from "@/lib/ssh";

import type { QueryViewCapabilities, QueryViewConnection } from "./types";

export function useServerOutput(
  connection: QueryViewConnection,
  database: string | null,
  caps: QueryViewCapabilities,
) {
  const [outputOpen, setOutputOpen] = useState(false);
  const [outputBusy, setOutputBusy] = useState(false);
  const outputEnabled = useServerOutputStore((state) =>
    connection ? state.enabled[connection.id] === true : false,
  );

  const collectOutput = useCallback(async () => {
    if (!connection || !caps.server_output) return;
    try {
      await collectServerOutput(
        connection.kind,
        effectiveConnectionString(connection),
        connection.id,
        database ?? undefined,
      );
    } catch {
      return;
    }
  }, [connection, database, caps.server_output]);

  const handleToggleServerOutput = useCallback(
    async (enabled: boolean) => {
      if (!connection) return;
      setOutputBusy(true);
      try {
        await toggleServerOutput(
          connection.kind,
          effectiveConnectionString(connection),
          connection.id,
          enabled,
          database ?? undefined,
        );
      } catch (err) {
        toast.error(String(err));
      } finally {
        setOutputBusy(false);
      }
    },
    [connection, database],
  );

  return {
    outputOpen,
    setOutputOpen,
    outputBusy,
    outputEnabled,
    collectOutput,
    handleToggleServerOutput,
  };
}

export type ServerOutputState = ReturnType<typeof useServerOutput>;
