import { useState } from "react";
import { toast } from "sonner";
import { ResizableDrawer } from "@/components/resizable-drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmExpertSql,
  fileLabel,
  pickDashboardFile,
  pickDashboardTarget,
  readDashboardFile,
  writeDashboardFile,
} from "@/lib/dashboard-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import { type Dashboard, useDashboardsStore } from "@/lib/dashboards";
import { useDbSelectionStore } from "@/lib/db-selection";

export function DashboardLibraryDrawer({
  open,
  onOpenChange,
  dashboard,
  dashboards,
  connectionId,
  database,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dashboard: Dashboard | null;
  dashboards: Dashboard[];
  connectionId: string;
  database: string | null;
}) {
  const width = useDashboardWorkspaceStore((s) => s.drawerWidths.dashboards);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const task = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Datei konnte nicht verarbeitet werden");
    } finally {
      setBusy(false);
    }
  };
  return (
    <ResizableDrawer
      open={open}
      onOpenChange={onOpenChange}
      side="left"
      title="Dashboards"
      description="Deine Dashboards öffnen, speichern und als Datei weitergeben."
      width={width}
      onWidthChange={(value) =>
        useDashboardWorkspaceStore.getState().setDrawerWidth("dashboards", value)
      }
    >
      <div className="space-y-5 p-4">
        <section className="space-y-3 rounded-lg border p-3">
          <h3 className="text-sm font-semibold">
            {dashboard ? dashboard.name : "Ein Dashboard starten"}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Deine Änderungen werden auf diesem Gerät automatisch gespeichert. Mit einer Datei kannst
            du ein Dashboard sichern oder weitergeben.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!dashboard || busy}
              onClick={() =>
                void task(async () => {
                  if (!dashboard) return;
                  const path = dashboard.filePath ?? (await pickDashboardTarget(dashboard.name));
                  if (!path) return;
                  const stamp = await writeDashboardFile(path, dashboard);
                  useDashboardsStore
                    .getState()
                    .update(dashboard.id, { filePath: path, fileStamp: stamp });
                  toast.success("Dashboard gespeichert");
                })
              }
            >
              Dashboard speichern
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!dashboard || busy}
              onClick={() =>
                void task(async () => {
                  if (!dashboard) return;
                  const path = await pickDashboardTarget(dashboard.name);
                  if (!path) return;
                  await writeDashboardFile(path, dashboard);
                  toast.success(`Kopie in ${fileLabel(path)} gespeichert`);
                })
              }
            >
              Speichern unter…
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void task(async () => {
                  const path = await pickDashboardFile();
                  if (!path) return;
                  const loaded = await readDashboardFile(path);
                  if (!confirmExpertSql(loaded.dashboard)) return;
                  useDashboardsStore.getState().importDashboard(
                    {
                      ...loaded.dashboard,
                      locked: true,
                      filePath: path,
                      fileStamp: loaded.stamp,
                    },
                    connectionId,
                    database,
                  );
                  onOpenChange(false);
                  toast.success("Dashboard geladen");
                })
              }
            >
              Aus Datei laden
            </Button>
          </div>
          {dashboard?.filePath && (
            <p className="break-all text-xs text-muted-foreground">Datei: {dashboard.filePath}</p>
          )}
        </section>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Auf diesem Gerät</h3>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              useDashboardsStore.getState().add(connectionId, database);
              onOpenChange(false);
            }}
          >
            Neues Dashboard
          </Button>
        </div>
        <Input
          aria-label="Dashboards suchen"
          placeholder="Dashboards suchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="space-y-2">
          {dashboards
            .filter((d) => d.name.toLowerCase().includes(search.toLowerCase()))
            .map((item) => (
              <article key={item.id} className="space-y-3 rounded-lg border p-3">
                <div>
                  <h4 className="text-sm font-medium">{item.name}</h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.widgets.length} Charts{item.database ? ` · ${item.database}` : ""}
                    {item.id === dashboard?.id ? " · Geöffnet" : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    onClick={() => {
                      if (item.database)
                        useDbSelectionStore.getState().setDatabase(connectionId, item.database);
                      useDashboardsStore.getState().setActive(connectionId, item.id);
                      onOpenChange(false);
                    }}
                  >
                    Dashboard öffnen
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => {
                      useDashboardsStore.getState().duplicate(item.id);
                      onOpenChange(false);
                    }}
                  >
                    Duplizieren
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      if (window.confirm(`Dashboard „${item.name}“ von diesem Gerät löschen?`))
                        useDashboardsStore.getState().remove(item.id);
                    }}
                  >
                    Löschen
                  </Button>
                </div>
              </article>
            ))}
          {!dashboards.some((d) => d.name.toLowerCase().includes(search.toLowerCase())) && (
            <p className="text-sm text-muted-foreground">Keine passenden Dashboards.</p>
          )}
        </div>
      </div>
    </ResizableDrawer>
  );
}
