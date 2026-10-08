import type { UseQueryResult } from "@tanstack/react-query";
import { ChartColumnIcon, CheckIcon, CircleAlertIcon, Table2Icon } from "lucide-react";
import { PanelErrorBoundary } from "@/components/error-boundary/panel-error-boundary";
import { Skeleton } from "@/components/ui/skeleton";
import { queryErrorMessage } from "@/lib/connection-url";
import { autoSubtitle, CHARTS, type Dataset, type Widget } from "@/lib/dashboards";
import type { QueryResult } from "@/lib/db";
import { ChartPreviewTable } from "./chart-preview-table";
import { CHART_RENDERERS, ChartHeadline, ChartLegend } from "./charts";
import { useWidgetData } from "./use-widget-data";

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
  const { options, shape, rows, problem, compare, summary, legend, summaryPending } = useWidgetData(
    { widget, dataset, period: widget.period, query, debounceMs: 500 },
  );
  const subtitle =
    widget.subtitle ??
    autoSubtitle(
      dataset.mode === "simple" ? (dataset.simple.dimension?.bucket ?? null) : null,
      shape?.hasDate ? widget.period : null,
      options.unit,
    );
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
      <div className="flex min-h-80 flex-1 shrink-0 flex-col overflow-hidden rounded-xl border bg-card p-4">
        <div className="mb-4 shrink-0">
          <p className="truncate text-sm font-medium">
            {widget.title || dataset.name || CHARTS[widget.chart].label}
          </p>
          {subtitle && <p className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</p>}
          {!noSource && !problem && !updating && query.isSuccess && (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              {options.showValue &&
                summary &&
                (summaryPending ? (
                  <Skeleton className="h-8 w-28" />
                ) : (
                  (summary.value !== null || summary.text) && (
                    <ChartHeadline summary={summary} options={options} />
                  )
                ))}
              <ChartLegend items={legend} className="ml-auto justify-end" />
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
          ) : problem || !shape ? (
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
              resetKeys={[rows, shape, options, widget.chart, compare]}
            >
              <Renderer
                rows={rows}
                shape={shape}
                options={options}
                compare={compare}
                period={shape.hasDate ? widget.period : undefined}
              />
            </PanelErrorBoundary>
          )}
        </div>
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
