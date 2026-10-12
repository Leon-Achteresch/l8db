import { useActiveConnection } from "@/lib/connections";
import { tableDialect } from "@/lib/dashboards/sql-tables";
import type { DatabaseKind } from "@/lib/db";

export function useSqlDialect(): DatabaseKind | null {
  const connection = useActiveConnection();
  return tableDialect(connection?.kind, connection?.connectionString);
}
