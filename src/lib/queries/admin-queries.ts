import { useQuery } from "@tanstack/react-query";
import { useActiveConnection } from "@/lib/connections";
import {
  executeQuery,
  getDatabaseOverview,
  getPartitionInfo,
  getTableRls,
  listEnums,
  listLocks,
  listMaterializedViews,
  listObjectGrants,
  listPublications,
  listSchedulerJobs,
  listSessions,
  listSubscriptions,
  listSynonyms,
  listUsedBy,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { loadQueryStats } from "@/lib/query-stats";
import { effectiveConnectionString } from "@/lib/ssh";

export function useMaterializedViewsQuery(schema?: string, enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["matviews", connection?.id, database, schema ?? ""],
    queryFn: () =>
      listMaterializedViews(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: enabled && supports(connection, "materialized_views"),
  });
}

export function useTableRlsQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["rls", connection?.id, database, schema, table],
    queryFn: () =>
      getTableRls(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "rls") && Boolean(schema) && Boolean(table),
  });
}

export function usePartitionInfoQuery(schema: string, table: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["partitions", connection?.id, database, schema, table],
    queryFn: () =>
      getPartitionInfo(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        table,
        database ?? undefined,
      ),
    enabled: supports(connection, "partitions") && Boolean(schema) && Boolean(table),
  });
}

export function usePublicationsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["publications", connection?.id, database],
    queryFn: () =>
      listPublications(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "replication"),
  });
}

export function useSubscriptionsQuery() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["subscriptions", connection?.id, database],
    queryFn: () =>
      listSubscriptions(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "replication"),
  });
}

export function useSessionsQuery(refetchInterval = 5000) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["sessions", connection?.id, database],
    queryFn: () =>
      listSessions(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: supports(connection, "sessions"),
    refetchInterval,
  });
}

export function useLocksQuery(refetchInterval = 5000) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["locks", connection?.id, database],
    queryFn: () =>
      listLocks(connection!.kind, effectiveConnectionString(connection!), database ?? undefined),
    enabled: supports(connection, "locks"),
    refetchInterval,
  });
}

export function useObjectGrantsQuery(schema: string, name: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["object-grants", connection?.id, database, schema, name],
    queryFn: () =>
      listObjectGrants(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        name,
        database ?? undefined,
      ),
    enabled: supports(connection, "object_grants") && schema.length > 0 && name.length > 0,
  });
}

export function useUsedByQuery(schema: string, name: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["used-by", connection?.id, database, schema, name],
    queryFn: () =>
      listUsedBy(
        connection!.kind,
        effectiveConnectionString(connection!),
        schema,
        name,
        database ?? undefined,
      ),
    enabled: supports(connection, "used_by") && schema.length > 0 && name.length > 0,
  });
}

export function useSynonymsQuery(schema?: string, enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["synonyms", connection?.id, database, schema ?? ""],
    queryFn: () =>
      listSynonyms(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: enabled && supports(connection, "synonyms"),
  });
}

export function useSchedulerJobsQuery(refetchInterval = 15000) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["scheduler-jobs", connection?.id, database],
    queryFn: () =>
      listSchedulerJobs(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "scheduler_jobs"),
    refetchInterval,
    retry: false,
  });
}

export function useEnumsQuery(schema?: string) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["enums", connection?.id, database, schema ?? ""],
    queryFn: () =>
      listEnums(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
        schema,
      ),
    enabled: supports(connection, "enums"),
  });
}

export function useDatabaseOverviewQuery(refetchInterval?: number) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["overview", connection?.id, database],
    queryFn: () =>
      getDatabaseOverview(
        connection!.kind,
        effectiveConnectionString(connection!),
        database ?? undefined,
      ),
    enabled: supports(connection, "overview"),
    refetchInterval,
    staleTime: 60_000,
  });
}

export function useQueryStatsQuery(limit: number, enabled = true) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  return useQuery({
    queryKey: ["query-stats", connection?.id, database, limit],
    queryFn: () =>
      loadQueryStats(connection!.kind, limit, (sql) =>
        executeQuery(
          connection!.kind,
          effectiveConnectionString(connection!),
          sql,
          database ?? undefined,
        ),
      ),
    enabled: enabled && supports(connection, "query_stats"),
    staleTime: 15_000,
    retry: false,
  });
}
