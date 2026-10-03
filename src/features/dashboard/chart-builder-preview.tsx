import type { UseQueryResult } from "@tanstack/react-query";
import { ChartColumnIcon, CheckIcon, CircleAlertIcon, Table2Icon } from "lucide-react";
import { useMemo } from "react";
import { AnimatedNumber } from "@/components/animated-number";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import {
  applyOptions,
  CHARTS,
  chartFits,
  colorSeries,
  type Dataset,
  datasetShape,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import type { QueryResult } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ChartPreviewTable } from "./chart-preview-table";
import {
  CHART_RENDERERS,
  ChartHeadline,
  deltaFor,
  headlineValue,
  LegendCards,
  legendFor,
} from "./charts";

const EMPTY_ROWS: Record<string, unknown>[] = [];

export function ChartBuilderPreview({
  widget,
  dataset,
  query,
  updating,
}: {
  widget: Widget;
  dataset: Dataset;
  query: UseQueryResult<QueryResult>;
  updating: boolean;
}) {
  const rawShape = useMemo(() => datasetShape(dataset), [dataset]);
  const options = useMemo(() => widgetOptions(widget), [widget]);
  const rawRows = query.data?.rows ?? EMPTY_ROWS;
  const applied = useMemo(
    () => applyOptions(rawShape, rawRows, options),
    [rawShape, rawRows, options],
  );
  const colored = useMemo(
    () => colorSeries(widget.chart, applied.shape, applied.rows),
    [applied, widget.chart],
  );
  const { shape, rows } = colored;
  const problem = chartFits(widget.chart, shape);
  const legend = useMemo(
    () => (!problem && options.showLegend ? legendFor(widget.chart, rows, shape, options) : []),
    [problem, options, widget.chart, rows, shape],
  );
  const isTime =
    (dataset.mode === "simple" &&
      Boolean(dataset.simple.dimension) &&
      dataset.simple.dimension?.bucket !== "none") ||
    /^\d{4}-\d{2}/.test(String(rows[0]?.[shape.dimension ?? ""] ?? ""));
  const delta =
    options.showDelta && options.sortBy === "none" ? deltaFor(rows, shape, isTime) : null;
  const Renderer = CHART_RENDERERS[widget.chart];
  const noSource = dataset.mode === "simple" ? !dataset.simple.table : !dataset.sql.trim();
  const loading = query.isFetching || updating;
  return (
    <aside
      aria-label="Chart-Vorschau"
      className="flex min-h-0 flex-col gap-4 overflow-y-auto bg-muted/20 p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold">Live-Vorschau</h2>
        <span role="status" className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {loading ? (
            "Wird aktualisiert…"
          ) : query.isError ? (
            <>
              <CircleAlertIcon className="size-3" /> Daten prüfen
            </>
          ) : query.isSuccess ? (
            <>
              <CheckIcon className="size-3" /> Aktuell
            </>
          ) : (
            "Warte auf Daten"
          )}
        </span>
      </div>
      <div className="flex min-h-64 flex-1 shrink-0 flex-col overflow-hidden rounded-xl border bg-card p-4">
        <div className="mb-4 shrink-0">
          <p className="text-xs font-medium text-muted-foreground">
            {widget.title || dataset.name || CHARTS[widget.chart].label}
          </p>
          {!noSource && !problem && options.showValue && query.isSuccess && !updating && (
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="text-3xl font-semibold tracking-tight tabular-nums">
                <ChartHeadline headline={headlineValue(widget.chart, rows, shape)} />
              </span>
              {delta !== null && (
                <span
                  className={cn(
                    "rounded-md px-1.5 py-0.5 text-[11px] font-semibold",
                    delta >= 0 ? "bg-lime-300/70 text-lime-950" : "bg-rose-200/80 text-rose-950",
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
        <div className="min-h-0 flex-1">
          {noSource ? (
            <div className="grid h-full min-h-48 place-content-center justify-items-center gap-3 px-6 text-center">
              <ChartColumnIcon className="size-8 text-muted-foreground/50" />
              <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
                Wähle eine Datenquelle. Deine Vorschau entsteht aus den Feldern, die du zuweist.
              </p>
            </div>
          ) : query.isError ? (
            <p role="alert" className="text-xs leading-relaxed text-destructive">
              {queryErrorMessage(query.error)}
            </p>
          ) : problem ? (
            <div className="grid h-full place-items-center px-5 text-center text-xs leading-relaxed text-muted-foreground">
              {problem}
            </div>
          ) : query.isPending || updating ? (
            <Skeleton className="h-full min-h-48 w-full rounded-lg" />
          ) : rows.length === 0 ? (
            <div className="grid h-full place-items-center text-xs text-muted-foreground">
              Keine Daten für diese Auswahl. Prüfe deine Filter.
            </div>
          ) : (
            <PanelErrorBoundary
              label="Die Chart-Vorschau"
              source="dashboard-chart-builder"
              compact
              resetKeys={[rows, shape, options, widget.chart]}
            >
              <Renderer rows={rows} shape={shape} options={options} />
            </PanelErrorBoundary>
          )}
        </div>
        {legend.length > 0 && !updating && (
          <div className="mt-4 shrink-0">
            <LegendCards items={legend} columns={2} />
          </div>
        )}
      </div>
      <section
        aria-label="Datenvorschau"
        className="shrink-0 overflow-hidden rounded-xl border bg-card"
      >
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Table2Icon className="size-3.5 text-muted-foreground" />
          <h3 className="text-xs font-medium">Daten hinter dem Chart</h3>
        </div>
        {updating ? (
          <p role="status" className="px-3 py-4 text-[11px] text-muted-foreground">
            Deine Auswahl wird geladen…
          </p>
        ) : (
          <ChartPreviewTable query={query} />
        )}
      </section>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        Änderungen erscheinen sofort in der Vorschau. Erst beim Speichern wird dein Dashboard
        aktualisiert.
      </p>
    </aside>
  );
}
