import { CalendarIcon, GripVerticalIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/animated-number";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { IconButton } from "@/components/icon-button";
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
  colorSeries,
  type Dataset,
  datasetShape,
  PERIOD_LABEL,
  type Period,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import {
  CHART_RENDERERS,
  ChartHeadline,
  deltaFor,
  headlineValue,
  LegendCards,
  legendFor,
} from "./charts";
import { useChartSlot } from "./use-chart-slot";
import { useDatasetSql, useSqlQuery } from "./use-dataset-query";

const EMPTY_ROWS: Record<string, unknown>[] = [];
export function WidgetCardInner({
  widget,
  dataset,
  refreshSec,
  locked,
  onChange,
  onRemove,
  onEdit,
}: {
  widget: Widget;
  dataset: Dataset | null;
  refreshSec: number;
  locked: boolean;
  onChange: (patch: Partial<Widget>) => void;
  onRemove: () => void;
  onEdit?: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [viewPeriod, setViewPeriod] = useState(widget.period);
  useEffect(() => setViewPeriod(widget.period), [widget.period]);
  const rawShape = useMemo(() => (dataset ? datasetShape(dataset) : null), [dataset]);
  const options = useMemo(() => widgetOptions({ options: widget.options }), [widget.options]);
  const sql = useDatasetSql(dataset, locked ? viewPeriod : widget.period);
  const query = useSqlQuery(sql, refreshSec * 1000);
  const rawRows = query.data?.rows ?? EMPTY_ROWS;
  const applied = useMemo(
    () => (rawShape ? applyOptions(rawShape, rawRows, options) : null),
    [rawShape, rawRows, options],
  );
  const colored = useMemo(
    () => (applied ? colorSeries(widget.chart, applied.shape, applied.rows) : null),
    [applied, widget.chart],
  );
  const shape = colored?.shape ?? null;
  const rows = colored?.rows ?? EMPTY_ROWS;
  const problem = shape ? chartFits(widget.chart, shape) : "Kein Datensatz zugewiesen";
  const isTime =
    (dataset?.mode === "simple" && dataset.simple.dimension?.bucket !== "none") ||
    /^\d{4}-\d{2}/.test(String(rows[0]?.[shape?.dimension ?? ""] ?? ""));
  const delta =
    shape && options.showDelta && options.sortBy === "none" ? deltaFor(rows, shape, isTime) : null;
  const Renderer = CHART_RENDERERS[widget.chart];
  const chartReady = useChartSlot(
    Boolean(shape) && !problem && query.isSuccess && rows.length > 0,
    rootRef,
  );
  const legend = useMemo(
    () =>
      shape && !problem && options.showLegend ? legendFor(widget.chart, rows, shape, options) : [],
    [shape, problem, options, widget.chart, rows],
  );
  const title = widget.title || dataset?.name || CHARTS[widget.chart].label;
  const legendColumns = widget.chart === "score" || widget.w < 5 ? 2 : widget.w >= 6 ? 4 : 3;
  const legendRows = Math.ceil(legend.length / legendColumns);

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col overflow-hidden rounded-2xl border border-border/50 bg-card p-5 shadow-xs"
    >
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1 text-sm text-muted-foreground">
            {!locked && (
              <GripVerticalIcon className="widget-drag-handle size-3.5 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" />
            )}
            <span className="truncate" title={title}>
              {title}
            </span>
          </div>
          {options.showValue && (
            <div className="mt-1.5 flex items-center gap-2.5">
              {query.isPending && sql ? (
                <Skeleton className="h-9 w-20" />
              ) : (
                <span className="text-3xl font-semibold tracking-tight tabular-nums">
                  {shape && !problem ? (
                    <ChartHeadline headline={headlineValue(widget.chart, rows, shape)} />
                  ) : (
                    "—"
                  )}
                </span>
              )}
              {delta !== null && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums",
                    delta >= 0
                      ? "bg-lime-400/20 text-lime-700 dark:bg-lime-400/15 dark:text-lime-300"
                      : "bg-rose-500/15 text-rose-700 dark:text-rose-400",
                  )}
                >
                  <AnimatedNumber
                    value={delta}
                    format={{
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                      signDisplay: "exceptZero",
                    }}
                    suffix="%"
                  />
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {shape?.hasDate && options.showPeriod && (
            <Select
              value={locked ? viewPeriod : widget.period}
              onValueChange={(period) =>
                locked ? setViewPeriod(period as Period) : onChange({ period: period as Period })
              }
            >
              <SelectTrigger
                size="sm"
                className="h-8 gap-1.5 rounded-lg bg-muted/40 text-xs font-medium"
              >
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
          {!locked && onEdit && (
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Chart bearbeiten"
              onClick={onEdit}
            >
              <SettingsIcon />
            </IconButton>
          )}
          {!locked && (
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Chart löschen"
              onClick={() => {
                if (window.confirm(`Chart „${title}“ löschen?`)) onRemove();
              }}
            >
              <Trash2Icon />
            </IconButton>
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
        ) : query.isPending || (rows.length > 0 && !chartReady) ? (
          <Skeleton className="h-full w-full rounded-xl" />
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Keine Daten
          </div>
        ) : (
          <PanelErrorBoundary
            label="Der Chart"
            source="dashboard-widget"
            compact
            resetKeys={[rows, shape, options, widget.chart]}
          >
            <Renderer rows={rows} shape={shape} options={options} />
          </PanelErrorBoundary>
        )}
      </div>
      {legendRows > 0 && widget.h >= 5 + legendRows && (
        <div className="mt-4 shrink-0">
          <LegendCards items={legend} columns={legendColumns} />
        </div>
      )}
    </div>
  );
}
