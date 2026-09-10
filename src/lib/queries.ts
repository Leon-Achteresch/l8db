import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { fetchTableRows, listDatabases, listSchemas, listTables } from "@/lib/db";

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

export function useTableRowsQuery(
  schema: string,
  table: string,
  filter?: string,
) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["rows", connection?.id, database, schema, table, filter ?? ""],
    queryFn: () =>
      fetchTableRows(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
        filter,
        undefined,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    placeholderData: keepPreviousData,
  });
}
