import {
  BookmarkIcon,
  CopyIcon,
  EllipsisIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { makeChartFile } from "@/lib/chart-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import {
  CHARTS,
  type ChartKind,
  chartFits,
  type Dataset,
  datasetShape,
  refLabel,
  type Widget,
} from "@/lib/dashboards";
import { ChartDataStep } from "./chart-data-step";
import { ChartPreviewTable } from "./chart-preview-table";
import { ChartQuestionStep } from "./chart-question-step";
import { ChartQuickForm } from "./chart-quick-form";
import { ChartStyleStep } from "./chart-style-step";
import { useDatasetSql, useDebounced, useSqlQuery } from "./use-dataset-query";
import { WidgetCardInner } from "./widget-card-inner";

export interface ChartDraft {
  widget: Widget;
  dataset: Dataset;
}

function ready(dataset: Dataset): boolean {
  return dataset.mode === "expert"
    ? dataset.sql.trim().length > 0 && dataset.mapping.metrics.length > 0
    : Boolean(dataset.simple.table) &&
        dataset.simple.metrics.some((m) => m.agg === "count" || m.column);
}

function autoTitle(dataset: Dataset): string {
  const shape = datasetShape(dataset);
  const metric = shape.metrics[0]?.label;
  if (dataset.mode === "expert" || !metric || !dataset.simple.table) return dataset.name;
  const dim = dataset.simple.dimension;
  return dim ? `${metric} pro ${refLabel(dim.column, dataset.simple)}` : metric;
}

function preferredChart(dataset: Dataset): ChartKind {
  const shape = datasetShape(dataset);
  const dated =
    dataset.mode === "simple" &&
    dataset.simple.dimension &&
    dataset.simple.dimension.bucket !== "none";
  const preferred: ChartKind = !shape.dimension ? "kpi" : dated ? "line" : "column";
  const all = Object.keys(CHARTS) as ChartKind[];
  return [preferred, ...all].find((k) => !chartFits(k, shape)) ?? preferred;
}

function fitChart(current: ChartKind, prev: Dataset, next: Dataset): ChartKind {
  const auto = current === preferredChart(prev);
  return auto || chartFits(current, datasetShape(next)) ? preferredChart(next) : current;
}

const noop = () => {};

export function ChartDialog({
  open,
  onOpenChange,
  draft,
  isNew,
  onSave,
  onDelete,
  onDuplicate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  draft: ChartDraft | null;
  isNew: boolean;
  onSave: (draft: ChartDraft) => void;
  onDelete?: () => void;
  onDuplicate?: () => void;
}) {
  const [state, setState] = useState<ChartDraft | null>(draft);
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (open) {
      setState(draft ? structuredClone(draft) : null);
      setAdvanced(draft?.dataset.mode === "expert");
    }
  }, [open, draft]);

  const dataset = state?.dataset ?? null;
  const widget = state?.widget ?? null;
  const liveSql = useDatasetSql(dataset, widget?.period ?? "all");
  const sql = useDebounced(liveSql, dataset?.mode === "expert" ? 1200 : 500);
  const preview = useSqlQuery(sql);
  const shape = useMemo(() => (dataset ? datasetShape(dataset) : null), [dataset]);

  if (!state || !dataset || !widget || !shape) return null;

  const title = autoTitle(dataset);
  const finished = { widget, dataset: { ...dataset, name: title } };
  const canFinish = ready(dataset);
  const patchDataset = (patch: Partial<Dataset>) =>
    setState((s) => {
      if (!s) return s;
      const next = { ...s.dataset, ...patch };
      return {
        dataset: next,
        widget: { ...s.widget, chart: fitChart(s.widget.chart, s.dataset, next) },
      };
    });
  const patchWidget = (patch: Partial<Widget>) =>
    setState((s) => (s ? { ...s, widget: { ...s.widget, ...patch } } : s));
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(760px,calc(100vh-2rem))] max-w-5xl! flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="border-b px-6 py-4">
          <DialogTitle className="text-base">
            {isNew ? "Neuer Chart" : "Chart bearbeiten"}
          </DialogTitle>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="min-h-0 overflow-y-auto p-6">
            {advanced ? (
              <Tabs defaultValue="question">
                <TabsList className="mb-5 w-full">
                  <TabsTrigger value="question">Daten & Filter</TabsTrigger>
                  <TabsTrigger value="style">Aussehen</TabsTrigger>
                  <TabsTrigger value="source">Quelle & SQL</TabsTrigger>
                </TabsList>
                <TabsContent value="question">
                  <ChartQuestionStep
                    dataset={dataset}
                    onChange={patchDataset}
                    resultColumns={preview.data?.columns ?? []}
                  />
                </TabsContent>
                <TabsContent value="style">
                  <ChartStyleStep widget={widget} shape={shape} onChange={patchWidget} />
                </TabsContent>
                <TabsContent value="source">
                  <ChartDataStep dataset={dataset} onChange={patchDataset} />
                </TabsContent>
              </Tabs>
            ) : (
              <ChartQuickForm
                dataset={dataset}
                widget={widget}
                shape={shape}
                titlePlaceholder={title || "Titel"}
                onDataset={patchDataset}
                onWidget={patchWidget}
              />
            )}
          </div>
          <aside className="hidden min-h-0 flex-col gap-3 border-l bg-muted/20 p-4 md:flex">
            <div className="min-h-56 flex-1">
              {dataset.mode === "simple" && !dataset.simple.table ? (
                <div className="grid h-full place-items-center rounded-2xl border border-dashed p-6 text-center text-xs text-muted-foreground">
                  Wähle links eine Tabelle, dann erscheint hier sofort die Vorschau.
                </div>
              ) : (
                <WidgetCardInner
                  widget={finished.widget}
                  dataset={finished.dataset}
                  refreshSec={0}
                  locked
                  onChange={noop}
                  onRemove={noop}
                />
              )}
            </div>
            {advanced && (
              <div className="max-h-44 shrink-0 overflow-hidden rounded-xl border bg-card">
                <ChartPreviewTable query={preview} />
              </div>
            )}
          </aside>
        </div>
        <div className="flex items-center gap-2 border-t px-6 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-52">
              <DropdownMenuItem
                disabled={!canFinish}
                onClick={() => {
                  useDashboardWorkspaceStore
                    .getState()
                    .saveChart(makeChartFile(widget, finished.dataset, widget.title || title));
                  toast.success("Chart in deiner Sammlung gespeichert");
                }}
              >
                <BookmarkIcon className="size-3.5" /> In Sammlung speichern
              </DropdownMenuItem>
              {onDuplicate && (
                <DropdownMenuItem
                  onClick={() => {
                    onDuplicate();
                    close();
                  }}
                >
                  <CopyIcon className="size-3.5" /> Duplizieren
                </DropdownMenuItem>
              )}
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => {
                      if (window.confirm("Diesen Chart wirklich löschen?")) {
                        onDelete();
                        close();
                      }
                    }}
                  >
                    <Trash2Icon className="size-3.5" /> Löschen
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={advanced}
            onClick={() => setAdvanced(!advanced)}
          >
            {advanced ? <Undo2Icon /> : <SlidersHorizontalIcon />}
            {advanced ? "Einfache Ansicht" : "Erweitert"}
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={close}>
              Abbrechen
            </Button>
            <Button
              size="sm"
              disabled={!canFinish}
              onClick={() => {
                onSave(finished);
                close();
              }}
            >
              {isNew ? "Zum Dashboard hinzufügen" : "Speichern"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
