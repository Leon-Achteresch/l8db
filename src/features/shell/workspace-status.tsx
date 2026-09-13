import { useIsFetching } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Database, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { ExtensionStatusBarItems } from "@/features/extensions/extension-status-bar-items";
import { ConnectionColorBadge } from "@/features/shell/connection-color-badge";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { DraftRecoveryDialog } from "./draft-recovery-dialog";

export function WorkspaceStatus() {
  const connection = useActiveConnection();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const database = useActiveDatabase();
  const caps = useActiveCapabilities();
  const schema = useActiveSchema();
  const activeTasks = useTasksStore((state) => state.tasks.filter(isTaskActive).length);
  const fetching = useIsFetching({
    predicate: (query) => Boolean(connection) && query.queryKey[1] === connection?.id,
  });
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-card/60 px-4 text-[10px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/connections" className="flex min-w-0 items-center gap-1.5 hover:text-foreground">
          <Database className="size-3 shrink-0" />
          {connection ? (
            <ConnectionColorBadge />
          ) : (
            <span className="max-w-40 truncate">Keine Verbindung</span>
          )}
        </Link>
        {connection && (
          <span className="truncate font-mono">
            {database} / {schema}
          </span>
        )}
        <ExtensionStatusBarItems side="left" />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ExtensionStatusBarItems side="right" />
        <button
          type="button"
          onClick={() => setRecoveryOpen(true)}
          className="rounded px-1 hover:text-foreground focus-visible:outline-2"
        >
          Entwürfe
        </button>
        <DraftRecoveryDialog open={recoveryOpen} onOpenChange={setRecoveryOpen} />
        <button
          type="button"
          onClick={() => useTasksStore.setState({ open: true })}
          className="rounded px-1 hover:text-foreground focus-visible:outline-2"
        >
          Aufgaben{activeTasks ? ` (${activeTasks})` : ""}
        </button>
        {Boolean(fetching) && <span role="status">Daten werden geladen…</span>}
        {connection && (
          <span className="hidden items-center gap-1 sm:flex">
            <LockKeyhole className="size-3" />
            {connection.ssh?.host ? "SSH · " : ""}
            {caps.query_language === "redis"
              ? connection.connectionString.startsWith("rediss:")
                ? "TLS"
                : "TLS aus"
              : connection.sslMode === "disable"
                ? "TLS aus"
                : `TLS ${connection.sslMode}`}
          </span>
        )}
      </div>
    </footer>
  );
}
