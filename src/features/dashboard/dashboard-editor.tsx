import { useQueryClient } from "@tanstack/react-query";
import { EyeIcon, FolderOpenIcon, LibraryIcon, PencilIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkflowNavigation } from "@/components/workflow-navigation";
import { confirmExpertSql, fileLabel, fileStamp, readDashboardFile } from "@/lib/dashboard-file";
import { type Dashboard, useDashboardsStore } from "@/lib/dashboards";
import { ChartLibraryDrawer } from "./chart-library-drawer";
import { ChartWorkspace } from "./chart-workspace";
import { DashboardCanvas } from "./dashboard-canvas";
import { DashboardLibraryDrawer } from "./dashboard-library-drawer";
export function DashboardEditor({
  dashboard,
  siblings,
  connectionId,
  database,
}: {
  dashboard: Dashboard;
  siblings: Dashboard[];
  connectionId: string;
  database: string | null;
}) {
  const store = useDashboardsStore();
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<"dashboards" | "charts" | null>(null);
  const [tab, setTab] = useState(dashboard.locked ? "dashboard" : "charts");
  const [selectedWidgetId, setSelectedWidgetId] = useState<string>();
  const editing = !dashboard.locked;
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    store.update(dashboard.id, patch);

  const path = dashboard.filePath ?? null;

  const reloadFile = useCallback(
    async (auto: boolean) => {
      if (!path) return;
      try {
        const stamp = await fileStamp(path);
        const current = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboard.id);
        if (!current || current.fileStamp === stamp) {
          if (!auto) toast.success("Dashboard ist aktuell");
          return;
        }
        if (!current.locked && auto) {
          toast.warning(`${fileLabel(path)} wurde geändert`, {
            action: { label: "Neu laden", onClick: () => void reloadFile(false) },
          });
          return;
        }
        const { dashboard: parsed } = await readDashboardFile(path);
        if (!confirmExpertSql(parsed)) return;
        store.update(dashboard.id, {
          name: parsed.name,
          datasets: parsed.datasets,
          widgets: parsed.widgets,
          refreshSec: parsed.refreshSec,
          fileStamp: stamp,
        });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
        toast.success(`${fileLabel(path)} neu geladen`);
      } catch (error) {
        if (!auto)
          toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden");
      }
    },
    [path, dashboard.id, store, queryClient],
  );

  useEffect(() => {
    if (!path) return;
    void reloadFile(true);
    const onFocus = () => void reloadFile(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [path, reloadFile]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <Button variant="outline" size="sm" onClick={() => setDrawer("dashboards")}>
          <FolderOpenIcon />
          Dashboards
        </Button>
        {editing ? (
          <Input
            className="h-8 w-48 text-xs"
            aria-label="Dashboard-Name"
            value={dashboard.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        ) : (
          <span className="truncate text-xs font-medium">{dashboard.name}</span>
        )}
        {path && (
          <span
            title={path}
            className="max-w-56 truncate rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {fileLabel(path)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            variant="ghost"
            size="icon-sm"
            aria-label="Alle Charts neu laden"
            onClick={() => {
              void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
              void reloadFile(false);
            }}
          >
            <RefreshCwIcon />
          </IconButton>
          {editing && (
            <Select
              value={String(dashboard.refreshSec)}
              onValueChange={(v) => update({ refreshSec: Number(v) })}
            >
              <SelectTrigger size="sm" className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="end">
                <SelectItem value="0">Kein Auto-Refresh</SelectItem>
                <SelectItem value="30">Alle 30 s</SelectItem>
                <SelectItem value="60">Jede Minute</SelectItem>
                <SelectItem value="300">Alle 5 Minuten</SelectItem>
              </SelectContent>
            </Select>
          )}
          <Button variant="outline" size="sm" onClick={() => setDrawer("charts")}>
            <LibraryIcon />
            Gespeicherte Charts
          </Button>
          <Button
            variant={editing ? "default" : "outline"}
            size="xs"
            aria-label={editing ? "Zur Ansicht wechseln" : "Dashboard bearbeiten"}
            onClick={() => {
              setTab("dashboard");
              update({ locked: editing });
            }}
          >
            {editing ? (
              <>
                <EyeIcon /> Read-only
              </>
            ) : (
              <>
                <PencilIcon /> Layout bearbeiten
              </>
            )}
          </Button>
        </div>
      </header>
      <DashboardLibraryDrawer
        open={drawer === "dashboards"}
        onOpenChange={(open) => setDrawer(open ? "dashboards" : null)}
        dashboard={dashboard}
        dashboards={siblings}
        connectionId={connectionId}
        database={database}
      />
      <ChartLibraryDrawer
        open={drawer === "charts"}
        onOpenChange={(open) => setDrawer(open ? "charts" : null)}
        dashboard={dashboard}
        selectedWidgetId={selectedWidgetId}
        onLoaded={(id) => {
          setSelectedWidgetId(id);
          setTab("charts");
        }}
      />
      <WorkflowNavigation
        value={editing ? tab : "dashboard"}
        onChange={(value) => {
          setTab(value);
          if (value === "charts") update({ locked: false });
        }}
        items={[
          {
            value: "charts",
            label: "Charts",
            description: "Hinzufügen, Daten zuordnen & filtern",
            count: dashboard.widgets.length,
          },
          { value: "dashboard", label: "Dashboard", description: "Charts anordnen & ansehen" },
        ]}
      />
      {editing && tab === "charts" ? (
        <ChartWorkspace
          dashboard={dashboard}
          selectedWidgetId={selectedWidgetId}
          onWidgetChange={setSelectedWidgetId}
          onLayout={() => setTab("dashboard")}
        />
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 border-b px-5 py-3">
            <div>
              <h2 className="text-sm font-semibold">
                {editing ? "Dein Dashboard zusammenstellen" : "Dashboard · Read-only"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "Charts am Griff verschieben und an der unteren rechten Ecke vergrößern."
                  : "Ansicht ohne Bearbeitung. Deine gespeicherten Charts bleiben unverändert."}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                update({ locked: false });
                setTab("charts");
              }}
            >
              Chart hinzufügen oder bearbeiten
            </Button>
          </div>
          <div className="workspace-canvas relative min-h-0 flex-1 overflow-y-auto">
            <DashboardCanvas
              dashboardId={dashboard.id}
              selectedDatasetId={null}
              onEdit={(id) => {
                setSelectedWidgetId(id);
                setTab("charts");
              }}
            />
          </div>
        </>
      )}
    </div>
  );
}
