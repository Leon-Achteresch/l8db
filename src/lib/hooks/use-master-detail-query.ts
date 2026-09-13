import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { executeQueryWithParams } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  bindMasterDetail,
  masterColumnSelection,
  masterDetailScriptError,
  useMasterDetail,
} from "@/lib/master-detail";
import { effectiveConnectionString } from "@/lib/ssh";

export function useMasterDetailQuery(source: string, sql: string, column?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const cell = useMasterDetail((state) => state.selections[source]);
  const selection = useMemo(() => masterColumnSelection(cell, column), [cell, column]);
  const supported = capabilities.query_language === "sql" && capabilities.bind_parameters;
  const input = useMemo(() => {
    const error = masterDetailScriptError(sql);
    if (error || !selection) return { error, bound: null };
    try {
      return {
        error: null,
        bound: bindMasterDetail(
          sql,
          selection.value,
          selection.row ?? { [selection.column]: selection.value },
        ),
      };
    } catch (failure) {
      return { error: failure instanceof Error ? failure.message : String(failure), bound: null };
    }
  }, [sql, selection]);
  const identity = JSON.stringify([connection?.id, database, input.bound]);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(identity), 120);
    return () => clearTimeout(timer);
  }, [identity]);
  const waiting = identity !== settled;
  const query = useQuery({
    queryKey: ["master-detail", source, identity],
    queryFn: async () => {
      if (!connection || !input.bound || !supported)
        throw new Error("Keine gültige Master-Detail-Verknüpfung.");
      return executeQueryWithParams(
        connection.kind,
        effectiveConnectionString(connection),
        input.bound.sql,
        input.bound.params,
        database ?? undefined,
      );
    },
    enabled: Boolean(connection && input.bound && supported && !waiting),
    retry: false,
    refetchOnWindowFocus: false,
    gcTime: 0,
  });
  return { query, selection, supported, waiting, error: input.error };
}
