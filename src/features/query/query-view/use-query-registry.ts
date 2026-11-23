import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { listAllColumns, listMaterializedViews, listTables, listViews } from "@/lib/db";
import { useAllSchemaObjectsQuery, useSchemasQuery } from "@/lib/queries";
import { editorMetadataEnabled } from "@/lib/queries/editor-metadata";
import { useSessionViews } from "@/lib/session-views";
import { DEFAULT_SQL_DIALECT, sqlDialectForKind, sqlDialectLabel } from "@/lib/sql-format-options";
import { effectiveConnectionString } from "@/lib/ssh";

import type { QueryViewCapabilities, QueryViewConnection } from "./types";

export function useQueryRegistry(
  connection: QueryViewConnection,
  database: string | null,
  caps: QueryViewCapabilities,
) {
  const { data: schemas } = useSchemasQuery();
  const sessionViews = useSessionViews(connection?.id, database);
  const sqlEditor = caps.query_language === "sql";
  const onDemand = sqlEditor && connection?.editorMetadataPrefetch === false;
  const enabled = () => editorMetadataEnabled(connection, sqlEditor);
  const objects = useAllSchemaObjectsQuery(false, onDemand);

  const {
    data: tables,
    isFetching: tablesLoading,
    isError: tablesError,
    refetch: refreshTables,
  } = useQuery({
    queryKey: ["all-tables", connection?.id, database],
    queryFn: () =>
      listTables(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled,
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
    enabled,
    staleTime: 60_000,
  });

  const views = useQuery({
    queryKey: ["all-views", connection?.id, database],
    queryFn: () =>
      listViews(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: () => caps.views && enabled(),
  });

  const matviews = useQuery({
    queryKey: ["all-matviews", connection?.id, database],
    queryFn: () =>
      listMaterializedViews(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: () => caps.materialized_views && enabled(),
  });

  const registry = useMemo(
    () => ({
      schemas: schemas ?? [],
      tables: [
        ...(tables ?? []),
        ...(views.data ?? []),
        ...(matviews.data ?? []).map(({ schema, name }) => ({ schema, name })),
        ...sessionViews.map(({ name }) => ({ schema: "", name })),
      ],
      columns: [
        ...(columns ?? []),
        ...sessionViews.flatMap((view) =>
          view.columns.map((name) => ({ schema: "", table: view.name, name, data_type: "" })),
        ),
      ],
    }),
    [schemas, tables, views.data, matviews.data, columns, sessionViews],
  );

  const dialectLabel = useMemo(() => {
    const dialect = sqlDialectForKind(connection?.kind);
    return dialect === DEFAULT_SQL_DIALECT ? caps.query_label : sqlDialectLabel(dialect);
  }, [connection?.kind, caps.query_label]);

  return {
    registry,
    dialectLabel,
    loading:
      tablesLoading ||
      columnsLoading ||
      (onDemand && (views.isFetching || matviews.isFetching || objects.isFetching)),
    error:
      tablesError ||
      columnsError ||
      (onDemand && (views.isError || matviews.isError || objects.isError)),
    waitingForMetadata: onDemand && (tables === undefined || columns === undefined),
    refresh: () => {
      if (!connection) return;
      const options = { cancelRefetch: false };
      void refreshTables(options);
      void refreshColumns(options);
      if (onDemand) {
        if (caps.views) void views.refetch(options);
        if (caps.materialized_views) void matviews.refetch(options);
        void objects.refetch(options);
      }
    },
  };
}
