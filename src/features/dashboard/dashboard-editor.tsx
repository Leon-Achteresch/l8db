import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  ChevronRightIcon,
  DatabaseIcon,
  EllipsisIcon,
  FolderOpenIcon,
  LayoutDashboardIcon,
  LibraryIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  TimerIcon,
  TimerOffIcon,
} from "lucide-react";
import { lazy, Suspense, startTransition, useCallback, useEffect, useState } from "react";
import { useStore } from "zustand";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuRadioItem,
  IconMenuSeparator,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuRadioGroup,
  DropdownMenuSub,
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
import { useHasNewFeatures } from "@/lib/new-features";
import type { ChartDraft } from "./chart-dialog";
import { ChartLibraryDrawer } from "./chart-library-drawer";
import { DashboardCanvas } from "./dashboard-canvas";
import { useDashboardFileReload } from "./dashboard-editor/use-dashboard-file-reload";
import { DashboardLibraryDrawer } from "./dashboard-library-drawer";

const REFRESH_OPTIONS = [
  ["30", "30s", "Alle 30 s"],
  ["60", "1m", "Jede Minute"],
  ["300", "5m", "Alle 5 Minuten"],
] as const;

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
  const hasNew = useHasNewFeatures("dashboard");
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
      const current =
        useDashboardsStore.getState().dashboards.find((d) => d.id === dashboard.id) ?? dashboard;
      const widget = current.widgets.find((w) => w.id === widgetId);
      if (!widget) return;
      const dataset =
        current.datasets.find((d) => d.id === widget.datasetId) ?? emptyDataset(widget.title);
      startTransition(() => {
        setDraft({ widget, dataset });
        setDraftIsNew(false);
        setDialogMounted(true);
        setDialogOpen(true);
      });
    },
    [dashboard],
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
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <header className="shrink-0 px-5 pt-4 pb-4 sm:px-7">
        <nav
          aria-label="Dashboard-Auswahl"
          className="mb-3 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
        >
          <LayoutDashboardIcon className="size-3.5 shrink-0" />
          <span>Dashboards</span>
          <ChevronRightIcon className="size-3 shrink-0 opacity-60" />
          <span className="max-w-40 truncate">{connection?.name}</span>
          <ChevronRightIcon className="size-3 shrink-0 opacity-60" />
          <span className="inline-flex items-center gap-1 truncate">
            <DatabaseIcon className="size-3.5 shrink-0" />
            {database || "Aktive Datenbank"}
          </span>
          <ChevronRightIcon className="size-3 shrink-0 opacity-60" />
          <Select
            value={dashboard.id}
            onValueChange={(id) => {
              const target = siblings.find((item) => item.id === id);
              if (target?.database)
                useDbSelectionStore.getState().setDatabase(connectionId, target.database);
              store.setActive(connectionId, id);
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-6 max-w-48 gap-1 border-transparent bg-transparent px-1.5 text-xs text-foreground/80 shadow-none hover:bg-muted dark:bg-transparent"
              aria-label="Dashboard auswählen"
            >
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
            size="icon-xs"
            aria-label="Neues Dashboard"
            onClick={() => store.add(connectionId, database)}
          >
            <PlusIcon />
          </Button>
        </nav>
        <div className="flex flex-wrap items-center gap-3">
          {editing ? (
            <Input
              className="h-9 w-64 max-w-full border-transparent bg-transparent px-0 text-2xl! font-semibold tracking-tight shadow-none hover:border-border focus-visible:px-2 dark:bg-transparent"
              aria-label="Dashboard-Name"
              value={dashboard.name}
              onChange={(e) => update({ name: e.target.value })}
            />
          ) : (
            <h1 className="truncate text-2xl font-semibold tracking-tight">{dashboard.name}</h1>
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
          {dashboard.refreshSec > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <TimerIcon className="size-3.5" />
              {dashboard.refreshSec} s
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
            <Button variant="outline" size="sm" onClick={() => setDrawer("charts")}>
              <LibraryIcon /> Gespeicherte Charts
            </Button>
            {editing && (
              <Button size="sm" onClick={startNewChart}>
                <PlusIcon /> Chart erstellen
                {hasNew && <NewBadge />}
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
              {!editing && hasNew && <NewBadge />}
            </Button>
            <IconMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon-sm" aria-label="Weitere Dashboard-Aktionen">
                  <EllipsisIcon />
                </Button>
              </DropdownMenuTrigger>
              <IconMenuContent>
                <IconMenuItem
                  icon={<RefreshCwIcon />}
                  label="Jetzt neu laden"
                  onSelect={() => {
                    void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
                    void reloadFile(false);
                  }}
                />
                <DropdownMenuSub>
                  <IconMenuSubTrigger icon={<TimerIcon />} label="Automatisch neu laden" />
                  <IconMenuSubContent>
                    <DropdownMenuRadioGroup
                      className="flex gap-0.5"
                      value={String(dashboard.refreshSec)}
                      onValueChange={(v) => update({ refreshSec: Number(v) })}
                    >
                      <IconMenuRadioItem value="0" icon={<TimerOffIcon />} label="Aus" />
                      {REFRESH_OPTIONS.map(([value, short, label]) => (
                        <IconMenuRadioItem
                          key={value}
                          value={value}
                          label={label}
                          icon={
                            <span className="text-[10px] font-semibold tabular-nums">{short}</span>
                          }
                        />
                      ))}
                    </DropdownMenuRadioGroup>
                  </IconMenuSubContent>
                </DropdownMenuSub>
                <IconMenuSeparator />
                <IconMenuItem
                  icon={<FolderOpenIcon />}
                  label="Dashboards verwalten"
                  onSelect={() => setDrawer("dashboards")}
                />
                <IconMenuItem
                  icon={<LibraryIcon />}
                  label="Gespeicherte Charts"
                  onSelect={() => setDrawer("charts")}
                />
              </IconMenuContent>
            </IconMenu>
          </div>
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
      <div className="relative min-h-0 flex-1 overflow-y-auto">
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
