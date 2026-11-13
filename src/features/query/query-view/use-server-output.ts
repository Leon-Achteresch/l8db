import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { transactionServerOutput } from "@/lib/db";
import {
  collectServerOutput,
  deliverServerOutput,
  onNextServerOutput,
  toggleServerOutput,
  useServerOutputStore,
} from "@/lib/server-output";
import { effectiveConnectionString } from "@/lib/ssh";
import { getQueryTransaction } from "@/lib/transactions";

import type { QueryViewCapabilities, QueryViewConnection } from "./types";

export function useServerOutput(
  connection: QueryViewConnection,
  database: string | null,
  caps: QueryViewCapabilities,
  running: boolean,
) {
  const [outputOpen, setOutputOpen] = useState(false);
  const streamed = useRef(false);
  const stopWatching = useRef<() => void>(undefined);
  const connectionId = connection?.id;
  useEffect(() => {
    if (!running || !connectionId || !caps.server_output) return;
    streamed.current = false;
    const stop = onNextServerOutput(connectionId, () => {
      streamed.current = true;
      setOutputOpen(true);
    });
    stopWatching.current = stop;
    return stop;
  }, [running, connectionId, caps.server_output]);
  const [outputBusy, setOutputBusy] = useState(false);
  const outputEnabled = useServerOutputStore((state) =>
    connection ? (state.enabled[connection.id] ?? connection.kind === "oracle") : false,
  );

  const collectOutput = useCallback(
    async (reveal = false) => {
      if (!connection || !caps.server_output) return;
      stopWatching.current?.();
      let added = 0;
      try {
        const tx = getQueryTransaction(connection.id, database);
        added = tx
          ? deliverServerOutput(connection.id, database, await transactionServerOutput(tx.txId))
          : await collectServerOutput(
              connection.kind,
              effectiveConnectionString(connection),
              connection.id,
              database ?? undefined,
            );
      } catch {
        added = 0;
      }
      if (!(reveal && streamed.current)) setOutputOpen(reveal && added > 0);
    },
    [connection, database, caps.server_output],
  );

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
