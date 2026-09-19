import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useActiveConnection } from "@/lib/connections";
import { countTableRows, fetchTableRows } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { sameTableSource } from "@/lib/query-client";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import { getTableTransaction } from "@/lib/transactions";
import { sortingToRowSort } from "./schema-queries";

export const PAGE_SIZE = 100;

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
    ],
    queryFn: () =>
      fetchTableRows(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        filter,
        rowLimit,
        page * rowLimit,
        database ?? undefined,
        sort,
        isView,
        allowRaw,
        getTableTransaction(connection!.id, database, schema, table)?.txId,
      ),
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
  return useQuery({
    queryKey: ["count", connection?.id, database, schema, table, filter ?? "", allowRaw],
    queryFn: () =>
      countTableRows(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        filter,
        database ?? undefined,
        allowRaw,
        getTableTransaction(connection!.id, database, schema, table)?.txId,
      ),
    enabled: enabled && Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}
