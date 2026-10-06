import { useActiveConnection } from "@/lib/connections";
import { useSqlQuery } from "../use-dataset-query";
import { type JoinStats, joinStatsSql, readJoinStats } from "./studio-model";

export function useJoinStats(
  parent: { schema: string; table: string } | null,
  child: { schema: string; table: string } | null,
  pairs: { from: string; to: string }[],
): { stats: JoinStats | null; loading: boolean; error: boolean } {
  const connection = useActiveConnection();
  const sql = parent && child ? joinStatsSql(connection?.kind ?? null, parent, child, pairs) : "";
  const query = useSqlQuery(sql);
  return {
    stats: readJoinStats(query.data?.rows?.[0]),
    loading: Boolean(sql) && query.isFetching,
    error: query.isError,
  };
}
