import { QueryClient } from "@tanstack/react-query";

export const METADATA_QUERY_ROOTS = [
  "databases",
  "schemas",
  "tables",
  "views",
  "matviews",
  "columns",
  "columns-detailed",
  "view-definition",
  "functions",
  "procedures",
  "function-definition",
  "extensions",
  "available-extensions",
  "roles",
  "role-privileges",
  "foreign-keys",
  "triggers",
  "er-schema",
  "all-tables",
  "all-views",
  "all-matviews",
  "all-columns",
  "all-objects",
  "sequences",
  "indexes",
  "constraints",
  "rls",
  "partitions",
  "publications",
  "subscriptions",
  "enums",
  "used-by",
  "synonyms",
] as const;

const connectionQueryRoots = new Set<string>([
  ...METADATA_QUERY_ROOTS,
  "rows",
  "count",
  "sessions",
  "locks",
  "overview",
  "scheduler-jobs",
  "column-search",
  "source-search",
]);

export function isConnectionQuery(queryKey: readonly unknown[], connectionId: string) {
  return (
    typeof queryKey[0] === "string" &&
    connectionQueryRoots.has(queryKey[0]) &&
    queryKey[1] === connectionId
  );
}

export function sameTableSource(previous: readonly unknown[], next: readonly unknown[]) {
  return (
    previous[0] === "rows" &&
    next[0] === "rows" &&
    [1, 2, 3, 4, 8].every((index) => previous[index] === next[index])
  );
}

export function createAppQueryClient() {
  const client = new QueryClient({
    defaultOptions: { queries: { refetchOnWindowFocus: false } },
  });
  for (const root of METADATA_QUERY_ROOTS) {
    client.setQueryDefaults([root], { staleTime: 60_000 });
  }
  client.setQueryDefaults(["rows"], { gcTime: 60_000 });
  client.setQueryDefaults(["column-search"], { gcTime: 30_000 });
  client.setQueryDefaults(["source-search"], { gcTime: 30_000 });
  return client;
}
