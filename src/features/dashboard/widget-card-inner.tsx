import { CalendarIcon, GripVerticalIcon, SettingsIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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
  autoSubtitle,
  CHARTS,
  type Dataset,
  PERIOD_LABEL,
  type Period,
  type Widget,
} from "@/lib/dashboards";
import { CHART_RENDERERS, ChartHeadline, ChartLegend } from "./charts";
import { useDashboardPeriod } from "./dashboard-period";
import { useChartSlot } from "./use-chart-slot";
import { useDatasetSql, useSqlQuery } from "./use-dataset-query";
import { useWidgetData } from "./use-widget-data";

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
  const sharedPeriod = useDashboardPeriod();
  const period = sharedPeriod ?? (locked ? viewPeriod : widget.period);
  const sql = useDatasetSql(dataset, period);
  const query = useSqlQuery(sql, refreshSec * 1000);
  const { options, shape, rows, problem, compare, summary, legend, summaryPending } = useWidgetData(
    { widget, dataset, period, query, refreshMs: refreshSec * 1000 },
  );
  const Renderer = CHART_RENDERERS[widget.chart];
  const chartReady = useChartSlot(
    Boolean(shape) && !problem && query.isSuccess && rows.length > 0,
    rootRef,
  );
  const title = widget.title || dataset?.name || CHARTS[widget.chart].label;
  const periodPicker = Boolean(shape?.hasDate && options.showPeriod && !sharedPeriod);
  const subtitle =
    widget.subtitle ??
    autoSubtitle(
      dataset?.mode === "simple" ? (dataset.simple.dimension?.bucket ?? null) : null,
      shape?.hasDate && !periodPicker && !sharedPeriod ? period : null,
      options.unit,
    );
  const figure =
    options.showValue &&
    !problem &&
    !query.isError &&
    (query.isPending || summaryPending || summary?.value != null || Boolean(summary?.text));

  return (
    <div
      ref={rootRef}
      className="flex h-full flex-col overflow-hidden rounded-lg border bg-card p-4 shadow-xs"
    >
      <div className="mb-3 flex shrink-0 flex-col gap-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-1 text-sm font-medium text-foreground">
              {!locked && (
                <GripVerticalIcon className="widget-drag-handle size-3.5 shrink-0 cursor-grab text-muted-foreground/60 active:cursor-grabbing" />
              )}
              <span className="truncate" title={title}>
                {title}
              </span>
            </div>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs text-muted-foreground" title={subtitle}>
                {subtitle}
              </div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {periodPicker && (
              <Select
                value={locked ? viewPeriod : widget.period}
                onValueChange={(next) =>
                  locked ? setViewPeriod(next as Period) : onChange({ period: next as Period })
                }
              >
                <SelectTrigger
                  size="sm"
                  className="h-7 gap-1.5 border-transparent bg-transparent px-1.5 text-xs text-muted-foreground shadow-none hover:bg-muted dark:bg-transparent"
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
        {(figure || legend.length > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
            {figure &&
              (query.isPending || summaryPending || !summary ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <ChartHeadline summary={summary} options={options} />
              ))}
            <ChartLegend items={legend} className={figure ? "ml-auto justify-end" : undefined} />
          </div>
        )}
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
          <Skeleton className="h-full w-full rounded-md" />
        ) : rows.length === 0 ? (
          <div className="grid h-full place-items-center text-xs text-muted-foreground">
            Keine Daten
          </div>
        ) : (
          <PanelErrorBoundary
            label="Der Chart"
            source="dashboard-widget"
            compact
            resetKeys={[rows, shape, options, widget.chart, compare]}
          >
            <Renderer
              rows={rows}
              shape={shape}
              options={options}
              compare={compare}
              period={shape.hasDate ? period : undefined}
            />
          </PanelErrorBoundary>
        )}
      </div>
    </div>
  );
}
