import { useIsFetching } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Database, LockKeyhole } from "lucide-react";
import { useEffect, useState } from "react";
import { ExtensionStatusBarItems } from "@/features/extensions/extension-status-bar-items";
import { ConnectionColorBadge } from "@/features/shell/connection-color-badge";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities, useActiveDatabase, useActiveSchema } from "@/lib/db-selection";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { useWorkspaceStatusStore } from "@/lib/workspace-status";
import { version } from "../../../package.json";
import { DraftRecoveryDialog } from "./draft-recovery-dialog";
import { WorkspaceBranchStatus } from "./workspace-branch-status";
import { WorkspaceQueryStatus } from "./workspace-query-status";

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
  useEffect(() => {
    useWorkspaceStatusStore.setState({ visible: true });
    return () => useWorkspaceStatusStore.setState({ visible: false });
  }, []);
  return (
    <footer className="@container/footer flex h-7 shrink-0 items-center justify-between gap-3 border-t bg-card/60 px-4 text-[10px] text-muted-foreground">
      <div className="flex min-w-0 items-center gap-3">
        <Link
          to="/connections"
          className="flex min-w-0 items-center gap-1.5 hover:text-foreground @max-[500px]/footer:hidden"
        >
          <Database className="size-3 shrink-0" />
          {connection ? (
            <ConnectionColorBadge />
          ) : (
            <span className="max-w-40 truncate">Keine Verbindung</span>
          )}
        </Link>
        {connection && !caps.object_storage && (
          <span className="truncate font-mono @max-[600px]/footer:hidden">
            {database} / {schema}
          </span>
        )}
        <WorkspaceBranchStatus />
        <WorkspaceQueryStatus />
        <ExtensionStatusBarItems side="left" />
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <ExtensionStatusBarItems side="right" />
        <button
          type="button"
          onClick={() => setRecoveryOpen(true)}
          className="rounded px-1 hover:text-foreground focus-visible:outline-2 @max-[500px]/footer:hidden"
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
          <span className="hidden items-center gap-1 sm:flex @max-[700px]/footer:hidden">
            <LockKeyhole className="size-3" />
            {connection.ssh?.host ? "SSH · " : ""}
            {caps.object_storage
              ? /[?&]endpoint=http(%3A|:)/i.test(connection.connectionString)
                ? "TLS aus"
                : "TLS"
              : caps.query_language === "redis"
                ? connection.connectionString.startsWith("rediss:")
                  ? "TLS"
                  : "TLS aus"
                : connection.sslMode === "disable"
                  ? "TLS aus"
                  : `TLS ${connection.sslMode}`}
          </span>
        )}
        <span className="tabular-nums">v{version}</span>
      </div>
    </footer>
  );
}
