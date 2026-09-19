import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import {
  type Dataset,
  datasetSql,
  JOIN_PREFIX,
  joinOptions,
  joinRef,
  type Period,
  type SimpleDataset,
} from "@/lib/dashboards";
import { executeQuery, listTableColumnsDetailed } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useErSchemaQuery, useForeignKeysQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";

export function useDebounced<T>(value: T, delay = 600): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useDatasetSql(dataset: Dataset | null, period: Period): string {
  const connection = useActiveConnection();
  return dataset ? datasetSql(dataset, connection?.kind ?? null, period) : "";
}

export function useSqlQuery(sql: string, refetchInterval?: number) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["dashboard-data", connection?.id, database, sql],
    queryFn: () => {
      if (!connection) throw new Error("Keine Verbindung");
      return executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        sql,
        database ?? undefined,
      );
    },
    enabled: Boolean(connection && sql.trim()),
    staleTime: 30_000,
    retry: false,
    refetchInterval: refetchInterval || false,
  });
}

export function useTablesColumns(tables: { schema: string; table: string }[]) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQueries({
    queries: tables.map((t) => ({
      queryKey: ["columns-detailed", connection?.id, database, t.schema, t.table],
      queryFn: () => {
        if (!connection) throw new Error("Keine Verbindung");
        return listTableColumnsDetailed(
          connection.kind,
          effectiveConnectionString(connection),
          t.schema,
          t.table,
          database ?? undefined,
        );
      },
      enabled: Boolean(connection && t.table),
      staleTime: 5 * 60 * 1000,
    })),
  });
}

export interface DatasetColumn {
  ref: string;
  label: string;
  type: string;
}

export function useDatasetColumns(simple: SimpleDataset) {
  const forward = useForeignKeysQuery(simple.schema, simple.table);
  const er = useErSchemaQuery(simple.schema);
  const options = useMemo(() => {
    const fks = [...(forward.data ?? []), ...(er.data?.foreign_keys ?? [])];
    const found = simple.table ? joinOptions(simple.schema, simple.table, fks) : [];
    const extra = (simple.joins ?? [])
      .filter((j) => j.id && !found.some((o) => o.join.id === j.id))
      .map((j) => ({ join: { ...j, id: j.id ?? "" }, label: j.table }));
    return [...found, ...extra];
  }, [forward.data, er.data, simple.schema, simple.table, simple.joins]);
  const legacy = simple.join;
  const sources = useMemo(
    () => [
      { schema: simple.schema, table: simple.table },
      ...(legacy ? [{ schema: legacy.schema, table: legacy.table }] : []),
      ...options.map((o) => ({ schema: o.join.schema, table: o.join.table })),
    ],
    [simple.schema, simple.table, legacy, options],
  );
  const results = useTablesColumns(sources);
  const loading = results.some((r) => r.isLoading);
  const [base, ...rest] = results.map((r) => r.data);
  const legacyCols = legacy ? rest.shift() : undefined;
  const columns: DatasetColumn[] = [
    ...(base ?? []).map((c) => ({ ref: c.name, label: c.name, type: c.data_type })),
    ...(legacy && legacyCols
      ? legacyCols.map((c) => ({
          ref: `${JOIN_PREFIX}${c.name}`,
          label: `${legacy.table}.${c.name}`,
          type: c.data_type,
        }))
      : []),
    ...options.flatMap((o, i) =>
      (rest[i] ?? []).map((c) => ({
        ref: joinRef(o.join.id, c.name),
        label: `${o.label}.${c.name}`,
        type: c.data_type,
      })),
    ),
  ];
  const joins = useMemo(() => options.map((o) => o.join), [options]);
  return { columns, joins, loading };
}
