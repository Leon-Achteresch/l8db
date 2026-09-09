import { useQueries, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { useActiveConnection } from "@/lib/connections";
import { type Dataset, datasetSql, type Period } from "@/lib/dashboards";
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

export interface Relation {
  key: string;
  label: string;
  reverse: boolean;
  join: { schema: string; table: string; fromColumn: string; toColumn: string };
}

export function useRelations(schema: string, table: string): Relation[] {
  const forward = useForeignKeysQuery(schema, table);
  const er = useErSchemaQuery(schema);
  return useMemo(() => {
    const out: Relation[] = [];
    for (const fk of forward.data ?? []) {
      if (fk.from_table !== table || fk.from_schema !== schema) continue;
      out.push({
        key: `f:${fk.constraint_name}:${fk.from_column}`,
        label: `${fk.to_table} über ${fk.from_column}`,
        reverse: false,
        join: {
          schema: fk.to_schema,
          table: fk.to_table,
          fromColumn: fk.from_column,
          toColumn: fk.to_column,
        },
      });
    }
    for (const fk of er.data?.foreign_keys ?? []) {
      if (fk.to_table !== table || fk.to_schema !== schema) continue;
      if (fk.from_table === table && fk.from_schema === schema) continue;
      out.push({
        key: `r:${fk.constraint_name}:${fk.from_table}:${fk.from_column}`,
        label: `${fk.from_table} (verweist über ${fk.from_column})`,
        reverse: true,
        join: {
          schema: fk.from_schema,
          table: fk.from_table,
          fromColumn: fk.to_column,
          toColumn: fk.from_column,
        },
      });
    }
    return out;
  }, [forward.data, er.data, schema, table]);
}
