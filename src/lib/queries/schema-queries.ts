import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import { useCallback, useState } from "react";
import { useActiveConnection, visibleSchemas } from "@/lib/connections";
import {
  cancelExecution,
  getViewDefinition,
  listAllColumns,
  listDatabases,
  listFunctions,
  listProcedures,
  listSchemas,
  listTables,
  listViews,
  searchColumns,
  searchSource,
  type TableRowSort,
} from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { isConnectionQuery } from "@/lib/query-client";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTransactionStore } from "@/lib/transactions";
import { loadSharedSchemaObjects, runSchemaMetadataRequest } from "./schema-object-loading";

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

export function sortingToRowSort(sorting: SortingState): TableRowSort | undefined {
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
    select: (schemas) => visibleSchemas(connection, schemas),
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

export function useViewsQuery(enabled = true) {
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
    enabled: enabled && supports(connection, "views"),
  });
}

export function useAllSchemaObjectsQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const client = useQueryClient();
  return useQuery({
    queryKey: ["all-objects", connection?.id, database],
    queryFn: ({ signal }) => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      const kind = connection.kind;
      const connectionString = effectiveConnectionString(connection);
      const db = database ?? undefined;
      const cancel = (jobId: string) =>
        supports(connection, "query_cancel") ? cancelExecution(jobId) : Promise.resolve(false);
      return loadSharedSchemaObjects(client, signal, {
        tables: {
          queryKey: ["all-tables", connection.id, database],
          queryFn: ({ signal }) =>
            runSchemaMetadataRequest(
              client,
              connection.id,
              signal,
              (jobId) => listTables(kind, connectionString, db, undefined, { jobId }),
              cancel,
            ),
        },
        views: {
          queryKey: ["all-views", connection.id, database],
          queryFn: ({ signal }) =>
            supports(connection, "views")
              ? runSchemaMetadataRequest(
                  client,
                  connection.id,
                  signal,
                  (jobId) => listViews(kind, connectionString, db, undefined, { jobId }),
                  cancel,
                )
              : Promise.resolve([]),
        },
        functions: {
          queryKey: ["functions", connection.id, database, undefined],
          queryFn: ({ signal }) =>
            supports(connection, "functions")
              ? runSchemaMetadataRequest(
                  client,
                  connection.id,
                  signal,
                  (jobId) => listFunctions(kind, connectionString, db, undefined, { jobId }),
                  cancel,
                )
              : Promise.resolve([]),
        },
        procedures: {
          queryKey: ["procedures", connection.id, database, undefined],
          queryFn: ({ signal }) =>
            supports(connection, "procedures")
              ? runSchemaMetadataRequest(
                  client,
                  connection.id,
                  signal,
                  (jobId) => listProcedures(kind, connectionString, db, undefined, { jobId }),
                  cancel,
                )
              : Promise.resolve([]),
        },
      });
    },
    enabled: enabled && Boolean(connection),
    subscribed: enabled && Boolean(connection),
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

export function useColumnsQuery(tableType: "BASE TABLE" | "VIEW", enabled = true) {
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
    enabled: enabled && Boolean(connection),
    staleTime: 5 * 60 * 1000,
  });
}

export function useViewDefinitionQuery(schema: string, view: string, enabled = true) {
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
    enabled: enabled && supports(connection, "view_editor") && Boolean(schema) && Boolean(view),
  });
}
