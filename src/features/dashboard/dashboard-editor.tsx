import { useQueryClient } from "@tanstack/react-query";
import {
  CheckIcon,
  EllipsisIcon,
  FolderOpenIcon,
  LibraryIcon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  TimerIcon,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
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
import { confirmExpertSql, fileLabel, fileStamp, readDashboardFile } from "@/lib/dashboard-file";
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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b px-3 py-2">
        {editing ? (
          <Input
            className="h-8 w-56 text-sm font-medium"
            aria-label="Dashboard-Name"
            value={dashboard.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        ) : (
          <h1 className="truncate px-1 text-sm font-semibold">{dashboard.name}</h1>
        )}
        {path && (
          <span
            title={path}
            className="max-w-56 truncate rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground"
          >
            {fileLabel(path)}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1.5">
          {editing && (
            <Button size="sm" onClick={startNewChart}>
              <PlusIcon /> Chart
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
