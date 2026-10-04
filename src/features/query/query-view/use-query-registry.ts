import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { listAllColumns, listMaterializedViews, listTables, listViews } from "@/lib/db";
import { useSchemasQuery } from "@/lib/queries";
import { useSessionViews } from "@/lib/session-views";
import { sqlDialectForKind, sqlDialectLabel } from "@/lib/sql-format-options";
import { effectiveConnectionString } from "@/lib/ssh";

import type { QueryViewCapabilities, QueryViewConnection } from "./types";

export function useQueryRegistry(
  connection: QueryViewConnection,
  database: string | null,
  caps: QueryViewCapabilities,
) {
  const { data: schemas } = useSchemasQuery();
  const sessionViews = useSessionViews(connection?.id, database);

  const {
    data: tables,
    isFetching: tablesLoading,
    isError: tablesError,
    refetch: refreshTables,
  } = useQuery({
    queryKey: ["all-tables", connection?.id, database],
    queryFn: () =>
      listTables(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: Boolean(connection),
  });

  const {
    data: columns,
    isFetching: columnsLoading,
    isError: columnsError,
    refetch: refreshColumns,
  } = useQuery({
    queryKey: ["all-columns", connection?.id, database],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: Boolean(connection),
    staleTime: 60_000,
  });

  const { data: views } = useQuery({
    queryKey: ["all-views", connection?.id, database],
    queryFn: () =>
      listViews(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: Boolean(connection) && caps.views,
  });

  const { data: matviews } = useQuery({
    queryKey: ["all-matviews", connection?.id, database],
    queryFn: () =>
      listMaterializedViews(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: Boolean(connection) && caps.materialized_views,
  });

  const registry = useMemo(
    () => ({
      schemas: schemas ?? [],
      tables: [
        ...(tables ?? []),
        ...(views ?? []),
        ...(matviews ?? []).map(({ schema, name }) => ({ schema, name })),
        ...sessionViews.map(({ name }) => ({ schema: "", name })),
      ],
      columns: [
        ...(columns ?? []),
        ...sessionViews.flatMap((view) =>
          view.columns.map((name) => ({ schema: "", table: view.name, name, data_type: "" })),
        ),
      ],
    }),
    [schemas, tables, views, matviews, columns, sessionViews],
  );

  const dialectLabel = useMemo(
    () =>
      caps.query_language === "json"
        ? "MongoDB JSON"
        : caps.query_language === "redis"
          ? "Redis"
          : sqlDialectLabel(sqlDialectForKind(connection?.kind)),
    [connection?.kind, caps.query_language],
  );

  return {
    registry,
    dialectLabel,
    loading: tablesLoading || columnsLoading,
    error: tablesError || columnsError,
    refresh: () => {
      void refreshTables();
      void refreshColumns();
    },
  };
}
