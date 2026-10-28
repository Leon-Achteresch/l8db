import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { executeQueryWithParams, fetchTableRows } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import {
  bindMasterDetail,
  masterColumnSelection,
  masterDetailLiteral,
  masterDetailScriptError,
  masterDetailTable,
  useMasterDetail,
} from "@/lib/master-detail";
import { effectiveConnectionString } from "@/lib/ssh";
import { tableReadTransactionId, useTransactionStore } from "@/lib/transactions";

const MAX_DETAIL_ROWS = 1000;

export function useMasterDetailQuery(
  source: string,
  sql: string,
  column?: string,
  editable = false,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const cell = useMasterDetail((state) => state.selections[source]);
  const selection = useMemo(() => masterColumnSelection(cell, column), [cell, column]);
  const supported = capabilities.query_language === "sql" && capabilities.bind_parameters;
  const input = useMemo(() => {
    const error = masterDetailScriptError(sql);
    if (error || !selection) return { error, bound: null, table: null };
    try {
      const row = selection.row ?? { [selection.column]: selection.value };
      const kind = connection?.kind ?? "postgres";
      const inlined = bindMasterDetail(sql, selection.value, row, (value) =>
        masterDetailLiteral(value, kind),
      );
      return {
        error: null,
        bound: bindMasterDetail(sql, selection.value, row),
        table: editable && capabilities.row_edit ? masterDetailTable(inlined.sql, kind) : null,
      };
    } catch (failure) {
      return {
        error: failure instanceof Error ? failure.message : String(failure),
        bound: null,
        table: null,
      };
    }
  }, [sql, selection, connection?.kind, capabilities.row_edit, editable]);
  const txId = useTransactionStore((state) =>
    input.table
      ? tableReadTransactionId(
          state.transactions,
          connection?.id ?? "",
          database,
          input.table.schema,
          input.table.table,
        )
      : undefined,
  );
  const identity = JSON.stringify([connection?.id, database, input.bound, input.table]);
  const [settled, setSettled] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(identity), 120);
    return () => clearTimeout(timer);
  }, [identity]);
  const waiting = identity !== settled;
  const query = useQuery({
    queryKey: ["master-detail", source, identity, txId ?? null],
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === identity ? previous : undefined,
    queryFn: async () => {
      if (!connection || !input.bound || !supported)
        throw new Error("Keine gültige Master-Detail-Verknüpfung.");
      if (input.table) {
        try {
          return await fetchTableRows(
            connection.kind,
            effectiveConnectionString(connection),
            input.table.schema,
            input.table.table,
            input.table.where,
            Math.min(input.table.limit ?? MAX_DETAIL_ROWS, MAX_DETAIL_ROWS),
            0,
            database ?? undefined,
            undefined,
            undefined,
            true,
            txId,
          );
        } catch {}
      }
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
  return {
    query,
    queryKey: ["master-detail", source, identity],
    selection,
    supported,
    waiting,
    error: input.error,
    table: input.table,
  };
}
