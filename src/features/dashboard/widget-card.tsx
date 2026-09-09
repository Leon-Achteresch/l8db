import { CalendarIcon, GripVerticalIcon, SettingsIcon } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import {
  applyOptions,
  CHARTS,
  chartFits,
  createId,
  type Dataset,
  datasetShape,
  PERIOD_LABEL,
  type Period,
  useDashboardsStore,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { CHART_RENDERERS, deltaFor, headlineFor, LegendCards, legendFor } from "./charts";
import { useDatasetSql, useSqlQuery } from "./use-dataset-query";
import { WidgetSettings } from "./widget-settings";

const EMPTY_ROWS: Record<string, unknown>[] = [];

export const WidgetCard = memo(function WidgetCard({
  dashboardId,
  widgetId,
}: {
  dashboardId: string;
  widgetId: string;
}) {
  const widget = useDashboardsStore((s) =>
    s.dashboards.find((d) => d.id === dashboardId)?.widgets.find((w) => w.id === widgetId),
  );
  const dataset = useDashboardsStore((s) => {
    const d = s.dashboards.find((x) => x.id === dashboardId);
    const w = d?.widgets.find((x) => x.id === widgetId);
    return d?.datasets.find((x) => x.id === w?.datasetId) ?? null;
  });
  const refreshSec = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.refreshSec ?? 0,
  );
  const locked = useDashboardsStore(
    (s) => s.dashboards.find((d) => d.id === dashboardId)?.locked ?? false,
  );
  const update = useDashboardsStore((s) => s.update);
  if (!widget) return null;
  return (
    <WidgetCardInner
      widget={widget}
      dataset={dataset}
      refreshSec={refreshSec}
      locked={locked}
      onChange={(patch) =>
        update(dashboardId, (d) => ({
          widgets: d.widgets.map((w) => (w.id === widgetId ? { ...w, ...patch } : w)),
        }))
      }
      onRemove={() =>
        update(dashboardId, (d) => ({ widgets: d.widgets.filter((w) => w.id !== widgetId) }))
      }
      onDuplicate={() =>
        update(dashboardId, (d) => ({
          widgets: [...d.widgets, { ...widget, id: createId(), y: widget.y + widget.h }],
        }))
      }
      dashboardId={dashboardId}
    />
  );
});

function WidgetCardInner({
  widget,
  dataset,
  refreshSec,
  locked,
  onChange,
  onRemove,
  onDuplicate,
  dashboardId,
}: {
  widget: Widget;
  dataset: Dataset | null;
  refreshSec: number;
  locked: boolean;
  onChange: (patch: Partial<Widget>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  dashboardId: string;
}) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const rawShape = useMemo(() => (dataset ? datasetShape(dataset) : null), [dataset]);
  const options = useMemo(() => widgetOptions(widget), [widget]);
  const sql = useDatasetSql(dataset, widget.period);
  const query = useSqlQuery(sql, refreshSec * 1000);
  const rawRows = query.data?.rows ?? EMPTY_ROWS;
  const applied = useMemo(
    () => (rawShape ? applyOptions(rawShape, rawRows, options) : null),
    [rawShape, rawRows, options],
  );
  const shape = applied?.shape ?? null;
  const rows = applied?.rows ?? EMPTY_ROWS;
  const problem = shape ? chartFits(widget.chart, shape) : "Kein Datensatz zugewiesen";
  const isTime =
    (dataset?.mode === "simple" && dataset.simple.dimension?.bucket !== "none") ||
    /^\d{4}-\d{2}/.test(String(rows[0]?.[shape?.dimension ?? ""] ?? ""));
  const delta =
    shape && options.showDelta && options.sortBy === "none" ? deltaFor(rows, shape, isTime) : null;
  const Renderer = CHART_RENDERERS[widget.chart];
  const legend = useMemo(
    () =>
      shape && !problem && options.showLegend ? legendFor(widget.chart, rows, shape, options) : [],
    [shape, problem, options, widget.chart, rows],
  );
  const title = widget.title || dataset?.name || CHARTS[widget.chart].label;
  const legendColumns = widget.chart === "score" || widget.w < 5 ? 2 : widget.w >= 6 ? 4 : 3;
  const legendRows = Math.ceil(legend.length / legendColumns);

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card p-4 shadow-sm">
      <div className="mb-2 flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {!locked && (
              <GripVerticalIcon className="widget-drag-handle size-3.5 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" />
            )}
            <span className="truncate">{title}</span>
          </div>
          {options.showValue && (
            <div className="mt-0.5 flex items-center gap-2">
              {query.isPending && sql ? (
                <Skeleton className="h-7 w-16" />
              ) : (
                <span className="text-2xl font-semibold tracking-tight tabular-nums">
                  {shape && !problem ? headlineFor(widget.chart, rows, shape) : "—"}
                </span>
              )}
              {delta !== null && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    delta >= 0 ? "bg-lime-300/70 text-lime-950" : "bg-rose-200/80 text-rose-950",
                  )}
                >
                  {delta >= 0 ? "+" : ""}
                  {delta.toFixed(1)}%
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shape?.hasDate && options.showPeriod && (
            <Select
              value={widget.period}
              onValueChange={(period) => onChange({ period: period as Period })}
            >
              <SelectTrigger size="sm" className="h-7 gap-1 rounded-lg text-xs">
                <CalendarIcon className="size-3.5" />
                <span className={widget.w < 4 ? "sr-only" : undefined}>
                  <SelectValue />
                </span>
              </SelectTrigger>
              <SelectContent align="end">
                {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {PERIOD_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {!locked && (
            <>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Widget-Einstellungen"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon />
              </Button>
              <WidgetSettings
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                widget={widget}
                dashboardId={dashboardId}
                rows={rawRows}
                onChange={onChange}
                onRemove={onRemove}
                onDuplicate={onDuplicate}
              />
            </>
          )}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {problem || !shape ? (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            {problem}
          </div>
        ) : query.isError ? (
          <p role="alert" className="text-xs text-destructive">
            {queryErrorMessage(query.error)}
          </p>
        ) : query.isPending ? (
          <Skeleton className="h-full w-full rounded-xl" />
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Keine Daten
          </div>
        ) : (
          <Renderer rows={rows} shape={shape} options={options} />
        )}
      </div>
      {legendRows > 0 && widget.h >= 5 + legendRows && (
        <div className="mt-3 shrink-0">
          <LegendCards items={legend} columns={legendColumns} />
        </div>
      )}
    </div>
  );
}
