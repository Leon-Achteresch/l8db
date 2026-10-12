import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import {
  calcRef,
  type Dataset,
  datasetSql,
  JOIN_PREFIX,
  joinOptions,
  joinRef,
  type Period,
  type SimpleDataset,
} from "@/lib/dashboards";
import { cancelExecution, executeQuery, listTableColumnsDetailed } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useCapabilities } from "@/lib/providers";
import { useErSchemaQuery, useForeignKeysQuery } from "@/lib/queries";
import { runUntilAbandoned } from "@/lib/queries/abandoned-jobs";
import { effectiveConnectionString } from "@/lib/ssh";
import { useDashboardScope } from "./dashboard-scope";
import { withQuerySlot } from "./query-slots";
import { useSqlDialect } from "./use-sql-dialect";

const MEMORY_LIMIT = /MEMORY_LIMIT_EXCEEDED/;

export function useDebounced<T>(value: T, delay = 600): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function useDatasetSql(dataset: Dataset | null, period: Period): string {
  const kind = useSqlDialect();
  const scope = useDashboardScope();
  return dataset ? datasetSql(dataset, kind, period, scope) : "";
}

export function useSqlQuery(sql: string, refetchInterval?: number) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const parallel = useCapabilities(connection?.kind).dashboard_parallelism;
  return useQuery({
    queryKey: ["dashboard-data", connection?.id, database, sql],
    queryFn: (context) => {
      if (!connection) throw new Error("Keine Verbindung");
      const abort = new AbortController();
      let started = false;
      return runUntilAbandoned(
        context,
        (jobId) =>
          withQuerySlot(connection.id, parallel, abort.signal, () => {
            started = true;
            return executeQuery(
              connection.kind,
              effectiveConnectionString(connection),
              sql,
              database ?? undefined,
              { track: false, pooled: true, jobId },
            );
          }),
        (jobId) => {
          abort.abort();
          if (started) void cancelExecution(jobId).catch(() => undefined);
        },
      );
    },
    enabled: Boolean(connection && sql.trim()),
    staleTime: 30_000,
    retry: (failures, error) => failures < 1 && MEMORY_LIMIT.test(String(error)),
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
  source?: string;
  column?: string;
}

const CALC_TYPES = { number: "numeric", text: "text", date: "date" } as const;

export function useDatasetColumns(simple: SimpleDataset) {
  const forward = useForeignKeysQuery(simple.schema, simple.table);
  const er = useErSchemaQuery(simple.schema);
  const options = useMemo(() => {
    const fks = [...(forward.data ?? []), ...(er.data?.foreign_keys ?? [])];
    const found = simple.table ? joinOptions(simple.schema, simple.table, fks) : [];
    const extra = (simple.joins ?? [])
      .filter((j) => j.id && !found.some((o) => o.join.id === j.id))
      .map((j) => ({ join: { ...j, id: j.id ?? "" }, label: j.table }));
    for (const option of found) {
      const chosen = (simple.joins ?? []).find((j) => j.id === option.join.id);
      if (chosen) option.join = { ...option.join, ...chosen, id: option.join.id };
    }
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
    ...(base ?? []).map((c) => ({
      ref: c.name,
      label: c.name,
      type: c.data_type,
      source: "",
      column: c.name,
    })),
    ...(legacy && legacyCols
      ? legacyCols.map((c) => ({
          ref: `${JOIN_PREFIX}${c.name}`,
          label: `${legacy.table}.${c.name}`,
          type: c.data_type,
          source: "legacy",
          column: c.name,
        }))
      : []),
    ...options.flatMap((o, i) =>
      (rest[i] ?? []).map((c) => ({
        ref: joinRef(o.join.id, c.name),
        label: `${o.label}.${c.name}`,
        type: c.data_type,
        source: o.join.id,
        column: c.name,
      })),
    ),
    ...(simple.calculated ?? []).map((field) => ({
      ref: calcRef(field.id),
      label: field.label || "Berechnetes Feld",
      type: CALC_TYPES[field.type ?? "number"],
      source: "calc",
    })),
  ];
  const joins = useMemo(() => options.map((o) => o.join), [options]);
  return { columns, joins, loading };
}
