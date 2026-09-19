import { useQueryClient } from "@tanstack/react-query";
import {
  EyeIcon,
  FolderOpenIcon,
  LibraryIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useState } from "react";
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
import { fileLabel } from "@/lib/dashboard-file";
import {
  CHARTS,
  createId,
  type Dashboard,
  emptyDataset,
  settle,
  useDashboardsStore,
} from "@/lib/dashboards";
import { ChartDialog, type ChartDraft } from "./chart-dialog";
import { ChartLibraryDrawer } from "./chart-library-drawer";
import { DashboardCanvas } from "./dashboard-canvas";
import { useDashboardFileReload } from "./dashboard-editor/use-dashboard-file-reload";
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
  const [draft, setDraft] = useState<ChartDraft | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const editing = !dashboard.locked;
  const update = (patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) =>
    store.update(dashboard.id, patch);

  const path = dashboard.filePath ?? null;

  const reloadFile = useDashboardFileReload(dashboard.id, path);

  const startNewChart = () => {
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
    setDraft({ widget, dataset });
    setDraftIsNew(true);
    setDialogOpen(true);
  };

  const startEdit = (widgetId: string) => {
    const widget = dashboard.widgets.find((w) => w.id === widgetId);
    if (!widget) return;
    const dataset =
      dashboard.datasets.find((d) => d.id === widget.datasetId) ?? emptyDataset(widget.title);
    setDraft({ widget, dataset });
    setDraftIsNew(false);
    setDialogOpen(true);
  };

  const saveDraft = (next: ChartDraft) => {
    if (draftIsNew) {
      update((d) => ({
        widgets: [...d.widgets, next.widget],
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
            onClick={() => update({ locked: editing })}
          >
            {editing ? (
              <>
                <EyeIcon /> Fertig
              </>
            ) : (
              <>
                <PencilIcon /> Bearbeiten
              </>
            )}
          </Button>
          {editing && (
            <Button size="sm" onClick={startNewChart}>
              <PlusIcon /> Chart
            </Button>
          )}
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
      <ChartDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        draft={draft}
        isNew={draftIsNew}
        onSave={saveDraft}
        onDelete={draftIsNew ? undefined : deleteDraft}
        onDuplicate={draftIsNew ? undefined : duplicateDraft}
      />
      <div className="workspace-canvas relative min-h-0 flex-1 overflow-y-auto">
        <DashboardCanvas
          dashboardId={dashboard.id}
          onEdit={(id) => {
            if (editing) startEdit(id);
          }}
          onAdd={editing ? startNewChart : undefined}
        />
      </div>
    </div>
  );
}
