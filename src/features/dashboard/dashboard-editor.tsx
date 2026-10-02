import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  DatabaseIcon,
  EllipsisIcon,
  FolderOpenIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  TimerIcon,
} from "lucide-react";
import { lazy, Suspense, startTransition, useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UndoRedoControls } from "@/components/undo-redo-controls";
import { useActiveConnection } from "@/lib/connections";
import { fileLabel } from "@/lib/dashboard-file";
import {
  CHARTS,
  clearDashboardHistory,
  createId,
  type Dashboard,
  emptyDataset,
  redoDashboards,
  settle,
  undoDashboards,
  useDashboardsStore,
} from "@/lib/dashboards";
import { useDbSelectionStore } from "@/lib/db-selection";
import type { ChartDraft } from "./chart-dialog";
import { ChartLibraryDrawer } from "./chart-library-drawer";
import { DashboardCanvas } from "./dashboard-canvas";
import { useDashboardFileReload } from "./dashboard-editor/use-dashboard-file-reload";
import { DashboardLibraryDrawer } from "./dashboard-library-drawer";

const ChartDialog = lazy(() =>
  import("./chart-dialog").then((module) => ({ default: module.ChartDialog })),
);

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
  const connection = useActiveConnection();
  const queryClient = useQueryClient();
  const [drawer, setDrawer] = useState<"dashboards" | "charts" | null>(null);
  const [draft, setDraft] = useState<ChartDraft | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMounted, setDialogMounted] = useState(false);
  const editing = !dashboard.locked;
  const canUndo = useStore(useDashboardsStore.temporal, (state) => state.pastStates.length > 0);
  const canRedo = useStore(useDashboardsStore.temporal, (state) => state.futureStates.length > 0);

  useEffect(() => clearDashboardHistory(), []);
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    store.update(dashboard.id, patch);

  const path = dashboard.filePath ?? null;

  const reloadFile = useDashboardFileReload(dashboard.id, path);

  const startNewChart = useCallback(() => {
    const index = dashboard.widgets.length;
    const dataset = emptyDataset(`Chart ${index + 1}`);
    const previous = dashboard.datasets.find((d) => d.mode === "simple" && d.simple.table);
    if (previous) {
      dataset.simple = {
        ...dataset.simple,
        schema: previous.simple.schema,
        table: previous.simple.table,
      };
    }
    const widget = settle(
      {
        id: createId(),
        chart: "column",
        datasetId: dataset.id,
        title: "",
        period: "all",
        x: 0,
        y: 0,
        w: CHARTS.column.w,
        h: CHARTS.column.h,
      },
      dashboard.widgets,
    );
    startTransition(() => {
      setDraft({ widget, dataset });
      setDraftIsNew(true);
      setDialogMounted(true);
      setDialogOpen(true);
    });
  }, [dashboard.datasets, dashboard.widgets]);

  const startEdit = useCallback(
    (widgetId: string) => {
      const widget = dashboard.widgets.find((w) => w.id === widgetId);
      if (!widget) return;
      const dataset =
        dashboard.datasets.find((d) => d.id === widget.datasetId) ?? emptyDataset(widget.title);
      startTransition(() => {
        setDraft({ widget, dataset });
        setDraftIsNew(false);
        setDialogMounted(true);
        setDialogOpen(true);
      });
    },
    [dashboard.datasets, dashboard.widgets],
  );

  const saveDraft = (next: ChartDraft) => {
    if (draftIsNew) {
      update((d) => ({
        widgets: [
          ...d.widgets,
          settle(
            { ...next.widget, w: CHARTS[next.widget.chart].w, h: CHARTS[next.widget.chart].h },
            d.widgets,
          ),
        ],
        datasets: [...d.datasets, next.dataset],
      }));
      return;
    }
    update((d) => {
      const shared = d.widgets.some(
        (w) => w.id !== next.widget.id && w.datasetId === next.widget.datasetId,
      );
      const exists = d.datasets.some((x) => x.id === next.dataset.id);
      const dataset = shared || !exists ? { ...next.dataset, id: createId() } : next.dataset;
      return {
        datasets:
          shared || !exists
            ? [...d.datasets, dataset]
            : d.datasets.map((x) => (x.id === dataset.id ? dataset : x)),
        widgets: d.widgets.map((w) =>
          w.id === next.widget.id ? { ...next.widget, datasetId: dataset.id } : w,
        ),
      };
    });
  };

  const deleteDraft = () => {
    if (!draft) return;
    update((d) => ({
      widgets: d.widgets.filter((w) => w.id !== draft.widget.id),
      datasets: d.datasets.filter(
        (dataset) =>
          dataset.id !== draft.widget.datasetId ||
          d.widgets.some((w) => w.id !== draft.widget.id && w.datasetId === dataset.id),
      ),
    }));
  };

  const duplicateDraft = () => {
    if (!draft) return;
    update((d) => {
      const copy = settle(
        {
          ...structuredClone(draft.widget),
          id: createId(),
          title: `${draft.widget.title || draft.dataset.name || "Chart"} (Kopie)`,
        },
        d.widgets,
      );
      const dataset = { ...structuredClone(draft.dataset), id: createId() };
      copy.datasetId = dataset.id;
      return { widgets: [...d.widgets, copy], datasets: [...d.datasets, dataset] };
    });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-muted/15">
      <header className="shrink-0 border-b bg-background px-5 pt-4 pb-3 sm:px-7">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <LayoutDashboardIcon className="size-4" />
            <span>Dashboards</span>
            <span className="text-border">/</span>
            <span className="max-w-52 truncate">{connection?.name}</span>
          </div>
          <nav aria-label="Dashboard-Auswahl" className="flex items-center gap-2">
            <Select
              value={dashboard.id}
              onValueChange={(id) => {
                const target = siblings.find((item) => item.id === id);
                if (target?.database)
                  useDbSelectionStore.getState().setDatabase(connectionId, target.database);
                store.setActive(connectionId, id);
              }}
            >
              <SelectTrigger className="h-8 w-44 text-xs" aria-label="Dashboard auswählen">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {siblings.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Neues Dashboard"
              onClick={() => store.add(connectionId, database)}
            >
              <PlusIcon />
            </Button>
          </nav>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {editing ? (
            <Input
              className="h-10 w-64 max-w-full border-transparent bg-transparent px-0 text-xl! font-semibold tracking-tight shadow-none hover:border-border focus-visible:px-2"
              aria-label="Dashboard-Name"
              value={dashboard.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          ) : (
            <h1 className="truncate text-xl font-semibold tracking-tight">{dashboard.name}</h1>
          )}
          {path && (
            <span
              title={path}
              className="max-w-56 truncate rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {fileLabel(path)}
            </span>
          )}
          {dashboard.mcpId && (
            <span
              title="Über den l8db-MCP von einem KI-Assistenten angelegt. Änderungen werden in beide Richtungen synchronisiert."
              className="rounded-full border border-primary/40 px-2 py-0.5 text-[10px] font-medium text-primary"
            >
              MCP
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {editing && (
              <UndoRedoControls
                enabled={!dialogOpen}
                canUndo={canUndo}
                canRedo={canRedo}
                onUndo={undoDashboards}
                onRedo={redoDashboards}
              />
            )}
            <Button variant="ghost" size="sm" onClick={() => setDrawer("charts")}>
              <LibraryIcon /> Gespeicherte Charts
            </Button>
            {editing && (
              <Button size="sm" onClick={startNewChart}>
                <PlusIcon /> Chart erstellen
              </Button>
            )}
            <Button
              variant={editing ? "outline" : "default"}
              size="sm"
              aria-label={editing ? "Zur Ansicht wechseln" : "Dashboard bearbeiten"}
              onClick={() => update({ locked: editing })}
            >
              {editing ? <CheckIcon /> : <PencilIcon />}
              {editing ? "Fertig" : "Bearbeiten"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Weitere Dashboard-Aktionen">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuItem
                  onClick={() => {
                    void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
                    void reloadFile(false);
                  }}
                >
                  <RefreshCwIcon className="size-3.5" /> Jetzt neu laden
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <TimerIcon className="size-3.5" /> Automatisch neu laden
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup
                      value={String(dashboard.refreshSec)}
                      onValueChange={(v) => update({ refreshSec: Number(v) })}
                    >
                      <DropdownMenuRadioItem value="0">Aus</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="30">Alle 30 s</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="60">Jede Minute</DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="300">Alle 5 Minuten</DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setDrawer("dashboards")}>
                  <FolderOpenIcon className="size-3.5" /> Dashboards verwalten
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setDrawer("charts")}>
                  <LibraryIcon className="size-3.5" /> Gespeicherte Charts
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <DatabaseIcon className="size-3.5" /> {database || "Aktive Datenbank"}
          </span>
          <span>
            {dashboard.widgets.length} {dashboard.widgets.length === 1 ? "Chart" : "Charts"} ·{" "}
            {
              new Set(
                dashboard.datasets
                  .filter((d) => d.simple.table || d.mode === "expert")
                  .map((d) =>
                    d.mode === "expert" ? d.id : `${d.simple.schema}.${d.simple.table}`,
                  ),
              ).size
            }{" "}
            Datenquellen
          </span>
          <span className="inline-flex items-center gap-1.5">
            <TimerIcon className="size-3.5" />{" "}
            {dashboard.refreshSec
              ? `Aktualisierung alle ${dashboard.refreshSec} s`
              : "Manuelle Aktualisierung"}
          </span>
          <span className="sm:ml-auto">
            {editing
              ? "Charts am Griff verschieben · an der Ecke vergrößern"
              : "Ansicht · Layout geschützt"}
          </span>
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
        onLoaded={(id) => {
          update({ locked: false });
          startEdit(id);
        }}
      />
      {dialogMounted && (
        <Suspense fallback={null}>
          <ChartDialog
            open={dialogOpen}
            onOpenChange={setDialogOpen}
            draft={draft}
            isNew={draftIsNew}
            onSave={saveDraft}
            onDelete={draftIsNew ? undefined : deleteDraft}
            onDuplicate={draftIsNew ? undefined : duplicateDraft}
          />
        </Suspense>
      )}
      <div className="relative min-h-0 flex-1 overflow-y-auto bg-muted/20">
        <DashboardCanvas
          dashboardId={dashboard.id}
          onEdit={editing ? startEdit : undefined}
          onAdd={editing ? startNewChart : undefined}
          onOpenCharts={editing ? () => setDrawer("charts") : undefined}
        />
      </div>
    </div>
  );
}
