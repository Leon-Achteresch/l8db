import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import type { SavedConnection } from "@/lib/connections";
import { useActiveConnection } from "@/lib/connections";
import {
  beginTransaction,
  commitTransaction,
  countTableRows,
  deleteRowInTransaction,
  duplicateRowInTransaction,
  fetchTableRows,
  getDatabaseOverview,
  getErSchema,
  getFunctionDefinition,
  getPartitionInfo,
  getTableRls,
  getViewDefinition,
  insertRowInTransaction,
  listAllColumns,
  listAvailableExtensions,
  listConstraints,
  listDatabases,
  listEnums,
  listExtensions,
  listForeignKeys,
  listFunctions,
  listProcedures,
  listIndexes,
  listLocks,
  listSchedulerJobs,
  listSynonyms,
  listUsedBy,
  listMaterializedViews,
  listPublications,
  listRolePrivileges,
  listRoles,
  listSchemas,
  listSequences,
  listSessions,
  listSubscriptions,
  listTableColumnsDetailed,
  listTables,
  listTriggers,
  listViews,
  searchColumns,
  searchSource,
  rollbackTransaction,
  type TableData,
  type TableRowSort,
  updateRowInTransaction,
} from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { useSettingsStore } from "@/lib/settings";
import { effectiveConnectionString } from "@/lib/ssh";
import {
  type ActiveTransaction,
  getTransactionForConnection,
  type TransactionChange,
  useTransactionStore,
} from "@/lib/transactions";

const CONNECTION_QUERY_ROOTS = new Set([
  "databases",
  "schemas",
  "tables",
  "views",
  "matviews",
  "columns",
  "view-definition",
  "functions",
  "procedures",
  "function-definition",
  "extensions",
  "available-extensions",
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
  "indexes",
  "constraints",
  "rls",
  "partitions",
  "publications",
  "subscriptions",
  "sessions",
  "locks",
  "enums",
  "overview",
  "used-by",
  "synonyms",
  "scheduler-jobs",
]);

function isConnectionQuery(queryKey: readonly unknown[], connectionId: string) {
  const root = queryKey[0];
  return (
    typeof root === "string" && CONNECTION_QUERY_ROOTS.has(root) && queryKey[1] === connectionId
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
    queryFn: () => listDatabases(connection!.kind, effectiveConnectionString(connection!)),
    enabled: supports(connection, "databases"),
  });
}

export function useSchemasQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["schemas", connection?.id, database],
    queryFn: () =>
      listSchemas(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: supports(connection, "schemas"),
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
        effectiveConnectionString(connection!),
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
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "views"),
  });
}

export function useAllSchemaObjectsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["all-objects", connection?.id, database],
    queryFn: async () => {
      const kind = connection!.kind;
      const connectionString = effectiveConnectionString(connection!);
      const db = database ?? undefined;
      const [tables, views, functions, procedures] = await Promise.all([
        listTables(kind, connectionString, db),
        supports(connection, "views") ? listViews(kind, connectionString, db) : Promise.resolve([]),
        supports(connection, "functions")
          ? listFunctions(kind, connectionString, db)
          : Promise.resolve([]),
        supports(connection, "procedures")
          ? listProcedures(kind, connectionString, db)
          : Promise.resolve([]),
      ]);
      return { tables, views, functions, procedures };
    },
    enabled: Boolean(connection),
    staleTime: 60 * 1000,
  });
}

export function useColumnSearchQuery(term: string, schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const enabled = supports(connection, "column_search") && term.trim().length >= 2;
  return useQuery({
    queryKey: ["column-search", connection?.id, database, schema ?? "", term.trim()],
    queryFn: () =>
      searchColumns(
        connection!.kind,
        effectiveConnectionString(connection!),
        term.trim(),
        database ?? undefined,
        schema,
      ),
    enabled,
  });
}

export function useSourceSearchQuery(term: string, schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const enabled = supports(connection, "source_search") && term.trim().length >= 2;
  return useQuery({
    queryKey: ["source-search", connection?.id, database, schema ?? "", term.trim()],
    queryFn: () =>
      searchSource(
        connection!.kind,
        effectiveConnectionString(connection!),
        term.trim(),
        database ?? undefined,
        schema,
      ),
    enabled,
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
        effectiveConnectionString(connection!),
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
        effectiveConnectionString(connection!),
        schema,
        view,
        database ?? undefined,
      ),
    enabled: supports(connection, "view_editor") && Boolean(schema) && Boolean(view),
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
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "functions"),
  });
}

export function useProceduresQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["procedures", connection?.id, database, schema],
    queryFn: () =>
      listProcedures(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "procedures"),
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
        effectiveConnectionString(connection!),
        oid,
        database ?? undefined,
      ),
    enabled:
      (supports(connection, "functions") || supports(connection, "procedures")) && Boolean(oid),
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
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "extensions"),
  });
}

export function useRolesQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["roles", connection?.id, database],
    queryFn: () =>
      listRoles(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: supports(connection, "roles"),
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
        effectiveConnectionString(connection!),
        roleName,
        database ?? undefined,
      ),
    enabled: supports(connection, "privileges") && Boolean(roleName),
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
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "foreign_keys") && Boolean(schema) && Boolean(table),
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
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "triggers") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDetailedColumnsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["columns-detailed", connection?.id, database, schema, table],
    queryFn: () =>
      listTableColumnsDetailed(
        connection!.kind,
        effectiveConnectionString(connection!),
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
        effectiveConnectionString(connection!),
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
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "sequences"),
  });
}

export function useIndexesQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["indexes", connection?.id, database, schema, table],
    queryFn: () =>
      listIndexes(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "indexes") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useConstraintsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["constraints", connection?.id, database, schema, table],
    queryFn: () =>
      listConstraints(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "constraints") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAvailableExtensionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["available-extensions", connection?.id, database],
    queryFn: () =>
      listAvailableExtensions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "extensions"),
    staleTime: 10 * 60 * 1000,
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
  allowRaw = true,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const rowLimit = useSettingsStore((s) => s.rowLimit);
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
  allowRaw = true,
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

      const newCtid = await runInTransaction(
        connection!,
        database ?? null,
        (txId) => updateRowInTransaction(txId, schema, table, ctid, changedUpdates),
        () => ({
          type: "update",
          schema,
          table,
          ctid,
          oldValues: changedOld,
          newValues: changedUpdates,
        }),
      );

      return { newCtid };
    },
    onSuccess: (result, { ctid, updates }) => {
      queryClient.setQueriesData<TableData>({ queryKey: ["rows"] }, (old) => {
        if (!old) return old;
        const idx = old.rows.findIndex((r) => (r as Record<string, unknown>).__ctid__ === ctid);
        if (idx === -1) return old;
        const updatedRows = [...old.rows];
        updatedRows[idx] = {
          ...updatedRows[idx],
          __ctid__: result.newCtid,
          ...Object.fromEntries(Object.entries(updates).map(([k, v]) => [k, v])),
        };
        return { ...old, rows: updatedRows };
      });
    },
  });
}

const pendingTransactions = new Map<string, Promise<ActiveTransaction>>();

function ensureTransaction(
  connection: SavedConnection,
  database: string | null,
): Promise<ActiveTransaction> {
  const existing = getTransactionForConnection(connection.id);
  if (existing) return Promise.resolve(existing);
  let pending = pendingTransactions.get(connection.id);
  if (!pending) {
    pending = openTransaction(connection, database).finally(() =>
      pendingTransactions.delete(connection.id),
    );
    pendingTransactions.set(connection.id, pending);
  }
  return pending;
}

async function openTransaction(
  connection: SavedConnection,
  database: string | null,
): Promise<ActiveTransaction> {
  const store = useTransactionStore.getState();
  const txId = await beginTransaction(
    connection.kind,
    effectiveConnectionString(connection),
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

async function runInTransaction<T>(
  connection: SavedConnection,
  database: string | null,
  op: (txId: string) => Promise<T>,
  change: (result: T) => Omit<TransactionChange, "id" | "timestamp">,
): Promise<T> {
  const store = useTransactionStore.getState();
  if (
    getTransactionForConnection(connection.id) ||
    useSettingsStore.getState().transactionsEnabled
  ) {
    const tx = await ensureTransaction(connection, database);
    const result = await op(tx.txId);
    store.addChange(tx.txId, { id: crypto.randomUUID(), timestamp: Date.now(), ...change(result) });
    store.setPanelOpen(true);
    return result;
  }
  const txId = await beginTransaction(
    connection.kind,
    effectiveConnectionString(connection),
    database ?? undefined,
  );
  try {
    const result = await op(txId);
    await commitTransaction(txId);
    return result;
  } catch (err) {
    await rollbackTransaction(txId).catch(() => undefined);
    throw err;
  }
}

function splitRow(row: unknown) {
  const { __ctid__: ctid, ...rowValues } = row as { __ctid__?: string; [key: string]: unknown };
  return { ctid, rowValues };
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
      const row = await runInTransaction(
        connection!,
        database ?? null,
        (txId) => insertRowInTransaction(txId, schema, table, values),
        (inserted) => ({ type: "insert", schema, table, ...splitRow(inserted) }),
      );
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
      const row = await runInTransaction(
        connection!,
        database ?? null,
        (txId) => duplicateRowInTransaction(txId, schema, table, ctid),
        (inserted) => ({ type: "insert", schema, table, ...splitRow(inserted) }),
      );
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
      await runInTransaction(
        connection!,
        database ?? null,
        (txId) => deleteRowInTransaction(txId, schema, table, ctid),
        () => ({ type: "delete", schema, table, ctid, oldValues }),
      );
      return { ctid };
    },
    onSuccess: ({ ctid }) => {
      queryClient.setQueriesData<TableData>(
        { predicate: (q) => matchesTable(q.queryKey, "rows", schema, table) },
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.filter((r) => (r as Record<string, unknown>).__ctid__ !== ctid),
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

export function useMaterializedViewsQuery(schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["matviews", connection?.id, database, schema ?? ""],
    queryFn: () =>
      listMaterializedViews(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "materialized_views"),
  });
}

export function useTableRlsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["rls", connection?.id, database, schema, table],
    queryFn: () =>
      getTableRls(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "rls") && Boolean(schema) && Boolean(table),
  });
}

export function usePartitionInfoQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["partitions", connection?.id, database, schema, table],
    queryFn: () =>
      getPartitionInfo(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "partitions") && Boolean(schema) && Boolean(table),
  });
}

export function usePublicationsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["publications", connection?.id, database],
    queryFn: () =>
      listPublications(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "replication"),
  });
}

export function useSubscriptionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["subscriptions", connection?.id, database],
    queryFn: () =>
      listSubscriptions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "replication"),
  });
}

export function useSessionsQuery(refetchInterval = 5000) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["sessions", connection?.id, database],
    queryFn: () =>
      listSessions(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: supports(connection, "sessions"),
    refetchInterval,
  });
}

export function useLocksQuery(refetchInterval = 5000) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["locks", connection?.id, database],
    queryFn: () =>
      listLocks(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: supports(connection, "locks"),
    refetchInterval,
  });
}

export function useUsedByQuery(schema: string, name: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["used-by", connection?.id, database, schema, name],
    queryFn: () =>
      listUsedBy(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        name,
        database ?? undefined,
      ),
    enabled: supports(connection, "used_by") && schema.length > 0 && name.length > 0,
  });
}

export function useSynonymsQuery(schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["synonyms", connection?.id, database, schema ?? ""],
    queryFn: () =>
      listSynonyms(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "synonyms"),
  });
}

export function useSchedulerJobsQuery(refetchInterval = 15000) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["scheduler-jobs", connection?.id, database],
    queryFn: () =>
      listSchedulerJobs(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "scheduler_jobs"),
    refetchInterval,
    retry: false,
  });
}

export function useEnumsQuery(schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["enums", connection?.id, database, schema ?? ""],
    queryFn: () =>
      listEnums(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "enums"),
  });
}

export function useDatabaseOverviewQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["overview", connection?.id, database],
    queryFn: () =>
      getDatabaseOverview(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "overview"),
    staleTime: 60_000,
  });
}
