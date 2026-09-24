import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useActiveConnection } from "@/lib/connections";
import {
  cancelExecution,
  countTableRows,
  countTableRowsCapped,
  fetchTableRows,
  type RowCount,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { sameTableSource } from "@/lib/query-client";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import { tableReadTransactionId, useTransactionStore } from "@/lib/transactions";
import { runUntilAbandoned } from "./abandoned-jobs";
import { sortingToRowSort } from "./schema-queries";

export const PAGE_SIZE = 100;

export const ROW_COUNT_CAP = 100_000;

function cancelJob(jobId: string) {
  void cancelExecution(jobId).catch(() => undefined);
}

function rowCountKey(
  connectionId: string | undefined,
  database: string | null | undefined,
  schema: string,
  table: string,
  filter: string | undefined,
  allowRaw: boolean,
) {
  const where = filter?.trim() ? filter : "";
  return ["count", connectionId, database, schema, table, where, where ? allowRaw : true];
}

export function useTableRowsQuery(
  schema: string,
  table: string,
  filter?: string,
  sorting: SortingState = [],
  isView = false,
  page = 0,
  allowRaw = true,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const rowLimit = useSettingsStore((s) => s.rowLimit);
  const sort = sortingToRowSort(sorting);
  const queryClient = useQueryClient();
  const txId = useTransactionStore((state) =>
    tableReadTransactionId(state.transactions, connection?.id ?? "", database, schema, table),
  );
  return useQuery({
    queryKey: [
      "rows",
      connection?.id,
      database,
      schema,
      table,
      filter ?? "",
      sort?.column ?? "",
      sort?.desc ?? false,
      isView,
      page,
      rowLimit,
      allowRaw,
      txId,
    ],
    queryFn: (context) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return runUntilAbandoned(
        context,
        (jobId) =>
          fetchTableRows(
            connection.kind,
            effectiveConnectionString(connection),
            schema,
            table,
            filter,
            rowLimit,
            page * rowLimit,
            database ?? undefined,
            sort,
            isView,
            allowRaw,
            txId,
            { jobId },
          ),
        cancelJob,
      );
    },
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    placeholderData: (previousData, previousQuery) => {
      if (
        !previousData ||
        !previousQuery ||
        (queryClient.getQueryCache().get(previousQuery.queryHash) as unknown) !== previousQuery
      ) {
        return undefined;
      }
      const previousKey = previousQuery.queryKey;
      if (
        sameTableSource(previousKey, [
          "rows",
          connection?.id,
          database,
          schema,
          table,
          "",
          "",
          false,
          isView,
          undefined,
          undefined,
          undefined,
          txId,
        ])
      ) {
        return previousData;
      }
      return undefined;
    },
  });
}

export function useTableRowCountQuery(
  schema: string,
  table: string,
  filter?: string,
  allowRaw = true,
  enabled = true,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const txId = useTransactionStore((state) =>
    tableReadTransactionId(state.transactions, connection?.id ?? "", database, schema, table),
  );
  return useQuery<RowCount>({
    queryKey: [...rowCountKey(connection?.id, database, schema, table, filter, allowRaw), txId],
    queryFn: (context) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return runUntilAbandoned(
        context,
        (jobId) =>
          countTableRowsCapped(
            connection.kind,
            effectiveConnectionString(connection),
            schema,
            table,
            ROW_COUNT_CAP,
            filter,
            database ?? undefined,
            allowRaw,
            txId,
            { jobId },
          ),
        cancelJob,
      );
    },
    enabled: enabled && Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useExactRowCountMutation(
  schema: string,
  table: string,
  filter?: string,
  allowRaw = true,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const txId = useTransactionStore((state) =>
    tableReadTransactionId(state.transactions, connection?.id ?? "", database, schema, table),
  );
  return useMutation({
    mutationFn: () => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return countTableRows(
        connection.kind,
        effectiveConnectionString(connection),
        schema,
        table,
        filter,
        database ?? undefined,
        allowRaw,
        txId,
      );
    },
    onSuccess: (count) =>
      queryClient.setQueryData<RowCount>(
        [...rowCountKey(connection?.id, database, schema, table, filter, allowRaw), txId],
        { count, exact: true, estimate: null },
      ),
  });
}
