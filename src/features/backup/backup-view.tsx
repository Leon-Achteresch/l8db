import { useQuery } from "@tanstack/react-query";
import { ArchiveIcon, TriangleAlertIcon } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supportsRestore } from "@/lib/backup";
import { useBackupToolPaths } from "@/lib/backup-runner";
import { useActiveConnection } from "@/lib/connections";
import { backupProbe } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { supports } from "@/lib/providers";
import { effectiveConnectionString } from "@/lib/ssh";
import { BackupPanel } from "./backup-panel";
import { BackupToolsPanel } from "./backup-tools-panel";
import { RestorePanel } from "./restore-panel";

export function BackupView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const toolPaths = useBackupToolPaths((state) => state.paths);
  const enabled = supports(connection, "backup");
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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <Tabs defaultValue="backup" className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-2">
          <ArchiveIcon className="size-4 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">Sicherung</span>
          <TabsList className="h-7">
            <TabsTrigger value="backup" className="text-xs">
              Sichern
            </TabsTrigger>
            {supportsRestore(connection.kind) && (
              <TabsTrigger value="restore" className="text-xs">
                Wiederherstellen
              </TabsTrigger>
            )}
            {hasTools && (
              <TabsTrigger value="tools" className="text-xs">
                Werkzeuge
              </TabsTrigger>
            )}
          </TabsList>
          <span className="ml-auto truncate text-xs text-muted-foreground">
            {connection.name} · {database ?? "Standard-Datenbank"}
            {probe.data?.serverVersion ? ` · Server ${probe.data.serverVersion}` : ""}
          </span>
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
        <TabsContent value="backup" className="min-h-0 flex-1 overflow-y-auto p-4">
          <BackupPanel key={scope} connection={connection} database={database} tools={tools} />
        </TabsContent>
        {supportsRestore(connection.kind) && (
          <TabsContent value="restore" className="min-h-0 flex-1 overflow-y-auto p-4">
            <RestorePanel key={scope} connection={connection} database={database} tools={tools} />
          </TabsContent>
        )}
        {hasTools && (
          <TabsContent value="tools" className="min-h-0 flex-1 overflow-y-auto p-4">
            <BackupToolsPanel
              probe={probe.data}
              loading={probe.isFetching}
              onRefresh={() => void probe.refetch()}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
