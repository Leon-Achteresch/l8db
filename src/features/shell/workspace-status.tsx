import { useIsFetching } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Database, LockKeyhole } from "lucide-react";
import { ConnectionColorBadge } from "@/features/shell/connection-color-badge";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema } from "@/lib/db-selection";

export function WorkspaceStatus() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schema = useActiveSchema();
  const fetching = useIsFetching({
    predicate: (query) => Boolean(connection) && query.queryKey[1] === connection?.id,
  });
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-card/60 px-4 text-[10px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/connections" className="flex min-w-0 items-center gap-1.5 hover:text-foreground">
          <Database className="size-3 shrink-0" />
          {connection ? (
            <ConnectionColorBadge variant="status" />
          ) : (
            <span className="max-w-40 truncate">Keine Verbindung</span>
          )}
        </Link>
        {connection && (
          <span className="truncate font-mono">
            {database} / {schema}
          </span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {Boolean(fetching) && <span role="status">Daten werden geladen…</span>}
        {connection && (
          <span className="hidden items-center gap-1 sm:flex">
            <LockKeyhole className="size-3" />
            {connection.ssh?.host ? "SSH · " : ""}
            {connection.sslMode === "disable" ? "TLS aus" : `TLS ${connection.sslMode}`}
          </span>
        )}
      </div>
    </footer>
  );
}
