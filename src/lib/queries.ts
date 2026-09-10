import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";

import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import {
  beginTransaction,
  countTableRows,
  fetchTableRows,
  getFunctionDefinition,
  getViewDefinition,
  listDatabases,
  listExtensions,
  listForeignKeys,
  listFunctions,
  listRoles,
  listSchemas,
  listTables,
  listViews,
  updateRowInTransaction,
  type TableData,
  type TableRowSort,
} from "@/lib/db";
import {
  getTransactionForConnection,
  useTransactionStore,
  type TransactionChange,
} from "@/lib/transactions";

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

export function useViewsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["views", connection?.id, database, schema],
    queryFn: () =>
      listViews(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
        schema,
      ),
    enabled: Boolean(connection),
  });
}

export function useViewDefinitionQuery(schema: string, view: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["view-definition", connection?.id, database, schema, view],
    queryFn: () =>
      getViewDefinition(
        connection!.kind,
        connection!.connectionString,
        schema,
        view,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(view),
  });
}

export function useFunctionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["functions", connection?.id, database, schema],
    queryFn: () =>
      listFunctions(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
        schema,
      ),
    enabled: Boolean(connection),
  });
}

export function useFunctionDefinitionQuery(oid: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["function-definition", connection?.id, database, oid],
    queryFn: () =>
      getFunctionDefinition(
        connection!.kind,
        connection!.connectionString,
        oid,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(oid),
  });
}

export function useExtensionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["extensions", connection?.id, database],
    queryFn: () =>
      listExtensions(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
      ),
    enabled: Boolean(connection),
  });
}

export function useRolesQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["roles", connection?.id, database],
    queryFn: () =>
      listRoles(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
      ),
    enabled: Boolean(connection),
  });
}

export function useRolePrivilegesQuery(roleName: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["role-privileges", connection?.id, database, roleName],
    queryFn: () =>
      listRolePrivileges(
        connection!.kind,
        connection!.connectionString,
        roleName,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(roleName),
  });
}

export function useForeignKeysQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["foreign-keys", connection?.id, database, schema, table],
    queryFn: () =>
      listForeignKeys(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export const PAGE_SIZE = 100;

export function useTableRowsQuery(
  schema: string,
  table: string,
  filter?: string,
  sorting: SortingState = [],
  isView = false,
  page = 0,
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
      isView,
      page,
    ],
    queryFn: () =>
      fetchTableRows(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
        filter,
        PAGE_SIZE,
        page * PAGE_SIZE,
        database ?? undefined,
        sort,
        isView,
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
    mutationFn: async ({
      ctid,
      updates,
      oldValues,
    }: {
      ctid: string;
      updates: Record<string, string | null>;
      oldValues: Record<string, unknown>;
    }) => {
      const changedUpdates: Record<string, string | null> = {};
      const changedOld: Record<string, unknown> = {};
      for (const [col, newVal] of Object.entries(updates)) {
        const orig = oldValues[col];
        let origStr: string | null;
        if (orig === null || orig === undefined) {
          origStr = null;
        } else if (typeof orig === "object") {
          origStr = JSON.stringify(orig);
        } else {
          origStr = String(orig);
        }
        if (newVal !== origStr) {
          changedUpdates[col] = newVal;
          changedOld[col] = orig;
        }
      }

      if (Object.keys(changedUpdates).length === 0) {
        return { newCtid: ctid };
      }

      const store = useTransactionStore.getState();
      let tx = getTransactionForConnection(connection!.id);

      if (!tx) {
        const txId = await beginTransaction(
          connection!.kind,
          connection!.connectionString,
          database ?? undefined,
        );
        const newTx = {
          txId,
          connectionId: connection!.id,
          connectionName: connection!.name,
          database: database ?? undefined,
          changes: [] as TransactionChange[],
          startedAt: Date.now(),
        };
        store.addTransaction(newTx);
        tx = newTx;
      }

      const newCtid = await updateRowInTransaction(
        tx.txId,
        schema,
        table,
        ctid,
        changedUpdates,
      );

      store.addChange(tx.txId, {
        id: crypto.randomUUID(),
        type: "update",
        timestamp: Date.now(),
        schema,
        table,
        ctid,
        oldValues: changedOld,
        newValues: changedUpdates,
      });

      store.setPanelOpen(true);

      return { newCtid };
    },
    onSuccess: (result, { ctid, updates }) => {
      queryClient.setQueriesData<TableData>(
        { queryKey: ["rows"] },
        (old) => {
          if (!old) return old;
          const idx = old.rows.findIndex(
            (r) => (r as Record<string, unknown>).__ctid__ === ctid,
          );
          if (idx === -1) return old;
          const updatedRows = [...old.rows];
          updatedRows[idx] = {
            ...updatedRows[idx],
            __ctid__: result.newCtid,
            ...Object.fromEntries(
              Object.entries(updates).map(([k, v]) => [k, v]),
            ),
          };
          return { ...old, rows: updatedRows };
        },
      );
    },
  });
}
