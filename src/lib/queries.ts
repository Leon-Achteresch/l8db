import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";

import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import {
  beginTransaction,
  countTableRows,
  deleteRowInTransaction,
  duplicateRowInTransaction,
  fetchTableRows,
  getErSchema,
  getFunctionDefinition,
  getViewDefinition,
  insertRowInTransaction,
  listAllColumns,
  listDatabases,
  listExtensions,
  listForeignKeys,
  listFunctions,
  listRolePrivileges,
  listRoles,
  listSchemas,
  listSequences,
  listTables,
  listTriggers,
  listViews,
  updateRowInTransaction,
  type TableData,
  type TableRowSort,
} from "@/lib/db";
import {
  getTransactionForConnection,
  useTransactionStore,
  type ActiveTransaction,
  type TransactionChange,
} from "@/lib/transactions";
import type { SavedConnection } from "@/lib/connections";

const CONNECTION_QUERY_ROOTS = new Set([
  "databases",
  "schemas",
  "tables",
  "views",
  "columns",
  "view-definition",
  "functions",
  "function-definition",
  "extensions",
  "roles",
  "role-privileges",
  "foreign-keys",
  "triggers",
  "er-schema",
  "rows",
  "count",
  "all-tables",
  "all-columns",
  "sequences",
]);

function isConnectionQuery(queryKey: readonly unknown[], connectionId: string) {
  const root = queryKey[0];
  return (
    typeof root === "string" &&
    CONNECTION_QUERY_ROOTS.has(root) &&
    queryKey[1] === connectionId
  );
}

export function useRefreshConnection() {
  const connection = useActiveConnection();
  const queryClient = useQueryClient();
  const syncWithBackend = useTransactionStore((s) => s.syncWithBackend);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    if (!connection || isRefreshing) return;
    setIsRefreshing(true);
    try {
      await syncWithBackend();
      await queryClient.invalidateQueries({
        predicate: (query) => isConnectionQuery(query.queryKey, connection.id),
      });
    } finally {
      setIsRefreshing(false);
    }
  }, [connection, isRefreshing, queryClient, syncWithBackend]);

  return {
    refresh,
    isRefreshing,
    canRefresh: Boolean(connection),
  };
}

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

export function useColumnsQuery(tableType: "BASE TABLE" | "VIEW") {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["columns", connection?.id, database, schema, tableType],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
        schema,
        tableType,
      ),
    enabled: Boolean(connection),
    staleTime: 5 * 60 * 1000,
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

export function useTriggersQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["triggers", connection?.id, database, schema, table],
    queryFn: () =>
      listTriggers(
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

export function useErSchemaQuery(schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["er-schema", connection?.id, database, schema],
    queryFn: () =>
      getErSchema(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
        schema,
      ),
    enabled: Boolean(connection),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSequencesQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["sequences", connection?.id, database, schema],
    queryFn: () =>
      listSequences(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
        schema,
      ),
    enabled: Boolean(connection),
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

async function ensureTransaction(
  connection: SavedConnection,
  database: string | null,
): Promise<ActiveTransaction> {
  const store = useTransactionStore.getState();
  const existing = getTransactionForConnection(connection.id);
  if (existing) return existing;

  const txId = await beginTransaction(
    connection.kind,
    connection.connectionString,
    database ?? undefined,
  );
  const newTx: ActiveTransaction = {
    txId,
    connectionId: connection.id,
    connectionName: connection.name,
    database: database ?? undefined,
    changes: [],
    startedAt: Date.now(),
  };
  store.addTransaction(newTx);
  return newTx;
}

function matchesTable(
  queryKey: readonly unknown[],
  root: string,
  schema: string,
  table: string,
): boolean {
  return queryKey[0] === root && queryKey[3] === schema && queryKey[4] === table;
}

export function useInsertRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (values: Record<string, string | null>) => {
      const store = useTransactionStore.getState();
      const tx = await ensureTransaction(connection!, database ?? null);
      const row = await insertRowInTransaction(tx.txId, schema, table, values);

      const { __ctid__: ctid, ...rowValues } = row as {
        __ctid__?: string;
        [key: string]: unknown;
      };

      store.addChange(tx.txId, {
        id: crypto.randomUUID(),
        type: "insert",
        timestamp: Date.now(),
        schema,
        table,
        ctid: ctid,
        rowValues,
      });
      store.setPanelOpen(true);

      return { row };
    },
    onSuccess: ({ row }) => {
      queryClient.setQueriesData<TableData>(
        { predicate: (q) => matchesTable(q.queryKey, "rows", schema, table) },
        (old) => (old ? { ...old, rows: [...old.rows, row] } : old),
      );
      queryClient.setQueriesData<number>(
        { predicate: (q) => matchesTable(q.queryKey, "count", schema, table) },
        (old) => (typeof old === "number" ? old + 1 : old),
      );
    },
  });
}

export function useDuplicateRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (ctid: string) => {
      const store = useTransactionStore.getState();
      const tx = await ensureTransaction(connection!, database ?? null);
      const row = await duplicateRowInTransaction(tx.txId, schema, table, ctid);

      const { __ctid__: newCtid, ...rowValues } = row as {
        __ctid__?: string;
        [key: string]: unknown;
      };

      store.addChange(tx.txId, {
        id: crypto.randomUUID(),
        type: "insert",
        timestamp: Date.now(),
        schema,
        table,
        ctid: newCtid,
        rowValues,
      });
      store.setPanelOpen(true);

      return { row };
    },
    onSuccess: ({ row }) => {
      queryClient.setQueriesData<TableData>(
        { predicate: (q) => matchesTable(q.queryKey, "rows", schema, table) },
        (old) => (old ? { ...old, rows: [...old.rows, row] } : old),
      );
      queryClient.setQueriesData<number>(
        { predicate: (q) => matchesTable(q.queryKey, "count", schema, table) },
        (old) => (typeof old === "number" ? old + 1 : old),
      );
    },
  });
}

export function useDeleteRowMutation(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ctid,
      oldValues,
    }: {
      ctid: string;
      oldValues: Record<string, unknown>;
    }) => {
      const store = useTransactionStore.getState();
      const tx = await ensureTransaction(connection!, database ?? null);
      await deleteRowInTransaction(tx.txId, schema, table, ctid);

      store.addChange(tx.txId, {
        id: crypto.randomUUID(),
        type: "delete",
        timestamp: Date.now(),
        schema,
        table,
        ctid,
        oldValues,
      });
      store.setPanelOpen(true);

      return { ctid };
    },
    onSuccess: ({ ctid }) => {
      queryClient.setQueriesData<TableData>(
        { predicate: (q) => matchesTable(q.queryKey, "rows", schema, table) },
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.filter(
                  (r) => (r as Record<string, unknown>).__ctid__ !== ctid,
                ),
              }
            : old,
      );
      queryClient.setQueriesData<number>(
        { predicate: (q) => matchesTable(q.queryKey, "count", schema, table) },
        (old) => (typeof old === "number" ? Math.max(0, old - 1) : old),
      );
    },
  });
}
