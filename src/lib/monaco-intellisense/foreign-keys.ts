import type { QueryClient } from "@tanstack/react-query";
import type { ForeignKeyInfo, TableInfo } from "@/lib/db";
import {
  loadSharedSchemaObjects,
  runSchemaMetadataRequest,
  type SharedMetadataQuery,
} from "@/lib/queries/schema-object-loading";

export async function loadForeignKeys(
  client: QueryClient,
  connectionId: string,
  database: string | null,
  tables: TableInfo[],
  signal: AbortSignal,
  fetch: (schema: string, table: string, jobId: string) => Promise<ForeignKeyInfo[]>,
  cancel: (jobId: string) => unknown,
): Promise<ForeignKeyInfo[]> {
  const queries: Record<string, SharedMetadataQuery<ForeignKeyInfo[]>> = {};
  tables.forEach((table, index) => {
    queries[index] = {
      queryKey: ["foreign-keys", connectionId, database, table.schema, table.name],
      queryFn: ({ signal }) =>
        runSchemaMetadataRequest(
          client,
          connectionId,
          signal,
          (jobId) => fetch(table.schema, table.name, jobId),
          cancel,
        ),
    };
  });
  const loaded = await loadSharedSchemaObjects<Record<string, ForeignKeyInfo[]>>(
    client,
    signal,
    queries,
  );
  return Object.values(loaded).flat();
}
