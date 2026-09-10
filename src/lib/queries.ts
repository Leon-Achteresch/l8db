import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";

import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import {
  countTableRows,
  fetchTableRows,
  listDatabases,
  listSchemas,
  listTables,
  updateRow,
  type TableRowSort,
} from "@/lib/db";

function sortingToRowSort(sorting: SortingState): TableRowSort | undefined {
  const active = sorting[0];
  if (!active?.id) return undefined;
  return { column: active.id, desc: Boolean(active.desc) };
}

export function useDatabasesQuery() {
  const connection = useActiveConnection();
  return useQuery({
    queryKey: ["databases", connection?.id],
    queryFn: () =>
      listDatabases(connection!.kind, connection!.connectionString),
    enabled: Boolean(connection),
  });
}

export function useSchemasQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["schemas", connection?.id, database],
    queryFn: () =>
      listSchemas(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
      ),
    enabled: Boolean(connection),
  });
}

export function useTablesQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["tables", connection?.id, database, schema],
    queryFn: () =>
      listTables(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
        schema,
      ),
    enabled: Boolean(connection),
  });
}

export function useTableRowsQuery(
  schema: string,
  table: string,
  filter?: string,
  sorting: SortingState = [],
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const sort = sortingToRowSort(sorting);
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
    ],
    queryFn: () =>
      fetchTableRows(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
        filter,
        undefined,
        database ?? undefined,
        sort,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    placeholderData: (previousData, previousQuery) => {
      if (!previousData || !previousQuery) {
        return undefined;
      }
      const previousKey = previousQuery.queryKey;
      const previousSchema = previousKey[3];
      const previousTable = previousKey[4];
      if (previousSchema === schema && previousTable === table) {
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
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: [
      "count",
      connection?.id,
      database,
      schema,
      table,
      filter ?? "",
    ],
    queryFn: () =>
      countTableRows(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
        filter,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ctid, updates }: { ctid: string; updates: Record<string, string | null> }) =>
      updateRow(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
        ctid,
        updates,
        database ?? undefined,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["rows"] });
    },
  });
}
