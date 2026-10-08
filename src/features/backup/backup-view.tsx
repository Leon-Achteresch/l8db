import { useQuery } from "@tanstack/react-query";
import { TriangleAlertIcon } from "lucide-react";
import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supportsRestore } from "@/lib/backup";
import { useBackupToolPaths } from "@/lib/backup-runner";
import { useActiveConnection } from "@/lib/connections";
import { backupProbe } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";
import { BackupHistory } from "./backup-history";
import { BackupPanel } from "./backup-panel";
import { BackupToolStatus } from "./backup-tool-status";
import { BackupToolsPanel } from "./backup-tools-panel";
import { RestorePanel } from "./restore-panel";

export function BackupView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const toolPaths = useBackupToolPaths((state) => state.paths);
  const enabled = supports(connection, "backup");
  const [tab, setTab] = useState("backup");
  const [actions, setActions] = useState<HTMLDivElement | null>(null);
  const [restoreSource, setRestoreSource] = useState({ path: "", nonce: 0 });
  const probe = useQuery({
    queryKey: ["backup-probe", connection?.id, database, toolPaths],
    enabled: Boolean(connection) && enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () => {
      if (!connection) throw new Error("Keine Verbindung aktiv.");
      return backupProbe(
        connection.kind,
        effectiveConnectionString(connection),
        database ?? undefined,
        toolPaths,
      );
    },
  });

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }
  if (!enabled) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Sicherung und Wiederherstellung werden für diesen Datenbanktyp nicht unterstützt.
        </p>
      </div>
    );
  }

  const scope = JSON.stringify([connection.id, database]);
  const tools = probe.data?.tools;
  const hasTools = Boolean(tools?.length);
  const restore = supportsRestore(connection.kind);
  const current =
    (tab === "restore" && !restore) || (tab === "tools" && !hasTools) ? "backup" : tab;
  const openTools = () => setTab("tools");

  return (
    <Tabs
      value={current}
      onValueChange={setTab}
      className="flex h-full min-h-0 flex-1 flex-col gap-0 overflow-hidden"
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <TabsList className="group-data-horizontal/tabs:h-8">
          <TabsTrigger value="backup" className="px-3 text-xs">
            Sichern
          </TabsTrigger>
          {restore && (
            <TabsTrigger value="restore" className="px-3 text-xs">
              Wiederherstellen
            </TabsTrigger>
          )}
          {hasTools && (
            <TabsTrigger value="tools" className="px-3 text-xs">
              Werkzeuge
            </TabsTrigger>
          )}
        </TabsList>
        <div ref={setActions} className="ml-auto flex items-center gap-2" />
      </div>
      {(probe.data?.warnings.length ?? 0) > 0 && (
        <div className="grid gap-1 border-b bg-amber-500/10 px-4 py-2">
          {probe.data?.warnings.map((warning) => (
            <p
              key={warning}
              className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400"
            >
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </p>
          ))}
        </div>
      )}
      {probe.error && (
        <p role="alert" className="border-b px-4 py-2 text-xs text-destructive">
          {String(probe.error)}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <TabsContent value="backup" className="min-h-0 flex-1 overflow-y-auto">
            <BackupPanel
              key={scope}
              connection={connection}
              database={database}
              tools={tools}
              serverVersion={probe.data?.serverVersion}
              actions={actions}
              onOpenTools={openTools}
            />
          </TabsContent>
          {restore && (
            <TabsContent value="restore" className="min-h-0 flex-1 overflow-y-auto">
              <RestorePanel
                key={`${scope}-${restoreSource.nonce}`}
                connection={connection}
                database={database}
                tools={tools}
                initialPath={restoreSource.path}
                actions={actions}
                onOpenTools={openTools}
              />
            </TabsContent>
          )}
          {hasTools && (
            <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto">
              <BackupToolsPanel
                probe={probe.data}
                loading={probe.isFetching}
                onRefresh={() => void probe.refetch()}
                actions={actions}
              />
            </TabsContent>
          )}
          {current !== "tools" && <BackupToolStatus probe={probe.data} onOpen={openTools} />}
        </div>
        <BackupHistory
          connectionId={connection.id}
          database={database}
          canRestore={restore && !connection.readOnly}
          onRestore={(path) => {
            setRestoreSource((previous) => ({ path, nonce: previous.nonce + 1 }));
            setTab("restore");
          }}
        />
      </div>
    </Tabs>
  );
}
