import { BookmarkIcon, ChartColumnIcon, CopyIcon, EllipsisIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { IconMenu, IconMenuContent, IconMenuItem, IconMenuSeparator } from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { makeChartFile } from "@/lib/chart-file";
import { useDashboardWorkspaceStore } from "@/lib/dashboard-workspace";
import {
  applyOptions,
  CHARTS,
  type ChartKind,
  chartFits,
  type Dataset,
  datasetShape,
  refLabel,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import { useHasNewFeatures } from "@/lib/new-features";
import { ChartBuilderPreview } from "./chart-builder-preview";
import { ChartDataStep } from "./chart-data-step";
import { retainChartMetricSelection } from "./chart-metric-selection";
import { ChartQuestionStep } from "./chart-question-step";
import { ChartQuickForm } from "./chart-quick-form";
import { ChartStyleStep } from "./chart-style-step";
import { useDatasetSql, useDebounced, useSqlQuery } from "./use-dataset-query";

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

function autoTitle(dataset: Dataset, widget: Widget): string {
  const shape = applyOptions(datasetShape(dataset), [], widgetOptions(widget)).shape;
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
  const [tab, setTab] = useState("data");
  const builderIsNew = useHasNewFeatures("dashboard.visual-builder");
  const galleryIsNew = useHasNewFeatures("dashboard.chart-gallery");
  useEffect(() => {
    if (open) {
      setState(draft ? structuredClone(draft) : null);
      setTab(draft?.dataset.mode === "expert" ? "source" : "data");
    }
  }, [open, draft]);

  const dataset = state?.dataset ?? null;
  const widget = state?.widget ?? null;
  const liveSql = useDatasetSql(open ? dataset : null, widget?.period ?? "all");
  const sql = useDebounced(liveSql, dataset?.mode === "expert" ? 1200 : 500);
  const preview = useSqlQuery(sql);
  const shape = useMemo(() => (dataset ? datasetShape(dataset) : null), [dataset]);

  if (!state || !dataset || !widget || !shape) return null;

  const title = autoTitle(dataset, widget);
  const finished = { widget, dataset: { ...dataset, name: title } };
  const canFinish =
    ready(dataset) &&
    !chartFits(widget.chart, applyOptions(shape, [], widgetOptions(widget)).shape);
  const patchDataset = (patch: Partial<Dataset>) =>
    setState((s) => {
      if (!s) return s;
      const next = { ...s.dataset, ...patch };
      return {
        dataset: next,
        widget: {
          ...s.widget,
          chart: fitChart(s.widget.chart, s.dataset, next),
          options: retainChartMetricSelection(s.dataset, next, s.widget.options),
        },
      };
    });
  const patchWidget = (patch: Partial<Widget>) =>
    setState((s) => (s ? { ...s, widget: { ...s.widget, ...patch } } : s));
  const close = () => onOpenChange(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(900px,calc(100dvh-2rem))] w-[calc(100vw-2rem)] max-w-7xl! flex-col gap-0 overflow-hidden p-0"
        aria-describedby={undefined}
      >
        <div className="flex items-center gap-3 border-b px-6 py-5">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted">
            <ChartColumnIcon className="size-5 text-muted-foreground" />
          </div>
          <div>
            <DialogTitle className="text-lg tracking-tight">
              {isNew ? "Dein neuer Chart" : "Chart bearbeiten"}
            </DialogTitle>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Daten wählen, visuell gestalten und direkt verstehen.
            </p>
          </div>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_minmax(300px,0.6fr)] md:overflow-hidden">
          <div className="min-h-0 min-w-0 p-5 md:overflow-y-auto">
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="mb-5 w-full">
                <TabsTrigger value="data">
                  Daten gestalten
                  {builderIsNew && <NewBadge />}
                </TabsTrigger>
                <TabsTrigger value="style">
                  Darstellung
                  {galleryIsNew && <NewBadge />}
                </TabsTrigger>
                <TabsTrigger value="source">Quelle & SQL</TabsTrigger>
              </TabsList>
              <TabsContent value="data">
                {dataset.mode === "expert" ? (
                  <ChartQuestionStep
                    dataset={dataset}
                    onChange={patchDataset}
                    resultColumns={preview.data?.columns ?? []}
                  />
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
              </TabsContent>
              <TabsContent value="style">
                <ChartStyleStep widget={widget} shape={shape} onChange={patchWidget} />
              </TabsContent>
              <TabsContent value="source">
                <ChartDataStep dataset={dataset} onChange={patchDataset} />
              </TabsContent>
            </Tabs>
          </div>
          <ChartBuilderPreview
            widget={finished.widget}
            dataset={finished.dataset}
            query={preview}
            updating={sql !== liveSql}
          />
        </div>
        <div className="flex items-center gap-2 border-t px-6 py-3">
          <IconMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Weitere Aktionen">
                <EllipsisIcon />
              </Button>
            </DropdownMenuTrigger>
            <IconMenuContent align="start" side="top">
              <IconMenuItem
                icon={<BookmarkIcon />}
                label="In Sammlung speichern"
                disabled={!canFinish}
                onSelect={() => {
                  useDashboardWorkspaceStore
                    .getState()
                    .saveChart(makeChartFile(widget, finished.dataset, widget.title || title));
                  toast.success("Chart in deiner Sammlung gespeichert");
                }}
              />
              {onDuplicate && (
                <IconMenuItem
                  icon={<CopyIcon />}
                  label="Duplizieren"
                  onSelect={() => {
                    onDuplicate();
                    close();
                  }}
                />
              )}
              {onDelete && (
                <>
                  <IconMenuSeparator />
                  <IconMenuItem
                    icon={<Trash2Icon />}
                    label="Löschen"
                    variant="destructive"
                    onSelect={() => {
                      if (window.confirm("Diesen Chart wirklich löschen?")) {
                        onDelete();
                        close();
                      }
                    }}
                  />
                </>
              )}
            </IconMenuContent>
          </IconMenu>
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
