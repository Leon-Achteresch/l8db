import { useQuery } from "@tanstack/react-query";

import { useActiveConnection } from "@/lib/connections";
import { fetchTableRows, listTables } from "@/lib/db";

export function useTablesQuery() {
  const connection = useActiveConnection();
  return useQuery({
    queryKey: ["tables", connection?.id],
    queryFn: () =>
      listTables(connection!.kind, connection!.connectionString),
    enabled: Boolean(connection),
  });
}

export function useTableRowsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  return useQuery({
    queryKey: ["rows", connection?.id, schema, table],
    queryFn: () =>
      fetchTableRows(
        connection!.kind,
        connection!.connectionString,
        schema,
        table,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
  });
}
