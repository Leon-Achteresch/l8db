import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveConnection } from "@/lib/connections";
import type { ColumnRef } from "@/lib/constraint-designer";
import { listSchemas, listTableColumnsDetailed, listTables } from "@/lib/db";
import { useActiveCapabilities, useActiveDatabase } from "@/lib/db-selection";
import { effectiveConnectionString } from "@/lib/ssh";

interface ForeignKeyTargetOptions {
  schema: string;
  table: string;
  self: { schema: string; name: string; columns: ColumnRef[] } | null;
}

export function useForeignKeyTarget({ schema, table, self }: ForeignKeyTargetOptions) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const capabilities = useActiveCapabilities();
  const connectionString = connection ? effectiveConnectionString(connection) : null;
  const kind = connection?.kind;
  const isSelf = Boolean(self && table === self.name && schema === self.schema);

  const schemasQuery = useQuery({
    queryKey: ["fk-target-schemas", connection?.id, database],
    queryFn: () =>
      kind && connectionString ? listSchemas(kind, connectionString, database ?? undefined) : [],
    enabled: Boolean(kind && connectionString && capabilities.schemas),
    staleTime: 60 * 1000,
  });

  const tablesQuery = useQuery({
    queryKey: ["fk-target-tables", connection?.id, database, schema],
    queryFn: () =>
      kind && connectionString
        ? listTables(kind, connectionString, database ?? undefined, schema || undefined)
        : [],
    enabled: Boolean(kind && connectionString),
    staleTime: 60 * 1000,
  });

  const columnsQuery = useQuery({
    queryKey: ["columns-detailed", connection?.id, database, schema, table],
    queryFn: () =>
      kind && connectionString
        ? listTableColumnsDetailed(kind, connectionString, schema, table, database ?? undefined)
        : [],
    enabled: Boolean(kind && connectionString && table && !isSelf),
    staleTime: 5 * 60 * 1000,
  });

  const schemas = useMemo(() => {
    const list = schemasQuery.data ?? [];
    return schema && !list.includes(schema) ? [schema, ...list] : list;
  }, [schemasQuery.data, schema]);

  const tables = useMemo(() => {
    const names = (tablesQuery.data ?? []).map((t) => t.name);
    if (self?.name && self.schema === schema && !names.includes(self.name))
      names.unshift(self.name);
    return names;
  }, [tablesQuery.data, self?.name, self?.schema, schema]);

  const columns: ColumnRef[] | null = isSelf
    ? (self?.columns ?? [])
    : table
      ? (columnsQuery.data?.map((c) => ({
          name: c.name,
          data_type:
            c.character_maximum_length !== null && !c.data_type.includes("(")
              ? `${c.data_type}(${c.character_maximum_length})`
              : c.data_type,
          is_primary_key: c.is_primary_key,
        })) ?? null)
      : null;

  return {
    schemas,
    tables,
    columns,
    loadingTables: tablesQuery.isLoading,
    loadingColumns: Boolean(table) && !isSelf && columnsQuery.isLoading,
  };
}
