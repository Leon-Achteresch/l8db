import { useQuery } from "@tanstack/react-query";
import { useActiveConnection } from "@/lib/connections";
import {
  getErSchema,
  listAvailableExtensions,
  listConstraints,
  listForeignKeys,
  listIndexes,
  listSequences,
  listTableColumnsDetailed,
  listTriggers,
  tableComment,
} from "@/lib/db";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";

export function useForeignKeysQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["foreign-keys", connection?.id, database, schema, table],
    queryFn: () =>
      listForeignKeys(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "foreign_keys") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTriggersQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["triggers", connection?.id, database, schema, table],
    queryFn: () =>
      listTriggers(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "triggers") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useDetailedColumnsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["columns-detailed", connection?.id, database, schema, table],
    queryFn: () =>
      listTableColumnsDetailed(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useErSchemaQuery(schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["er-schema", connection?.id, database, schema],
    queryFn: () =>
      getErSchema(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: Boolean(connection),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSequencesQuery(enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  return useQuery({
    queryKey: ["sequences", connection?.id, database, schema],
    queryFn: () =>
      listSequences(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: enabled && supports(connection, "sequences"),
  });
}

export function useIndexesQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["indexes", connection?.id, database, schema, table],
    queryFn: () =>
      listIndexes(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "indexes") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useTableCommentQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["table-comment", connection?.id, database, schema, table],
    queryFn: () =>
      tableComment(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: Boolean(connection) && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useConstraintsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["constraints", connection?.id, database, schema, table],
    queryFn: () =>
      listConstraints(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "constraints") && Boolean(schema) && Boolean(table),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAvailableExtensionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["available-extensions", connection?.id, database],
    queryFn: () =>
      listAvailableExtensions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "extensions"),
    staleTime: 10 * 60 * 1000,
  });
}
