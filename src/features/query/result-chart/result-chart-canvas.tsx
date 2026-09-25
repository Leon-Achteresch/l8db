import { type Ref, useMemo } from "react";
import { CHART_RENDERERS, headlineFor, LegendCards, legendFor } from "@/features/dashboard/charts";
import { type ChartKind, chartFits, colorSeries, DEFAULT_OPTIONS } from "@/lib/dashboards";
import type { ResultChartData } from "@/lib/result-chart";

const OPTIONS = { ...DEFAULT_OPTIONS, showDelta: false, showPeriod: false };
const HEADLINE: ChartKind[] = ["kpi", "gauge", "score"];

export function ResultChartCanvas({
  chart,
  data,
  ref,
}: {
  chart: ChartKind;
  data: ResultChartData;
  ref?: Ref<HTMLDivElement>;
}) {
  const colored = useMemo(() => colorSeries(chart, data.shape, data.rows), [chart, data]);
  const problem = chartFits(chart, colored.shape);
  const legend = useMemo(
    () => (problem ? [] : legendFor(chart, colored.rows, colored.shape, OPTIONS)),
    [problem, chart, colored],
  );
  const Renderer = CHART_RENDERERS[chart];
  if (problem)
    return (
      <div className="grid h-full place-items-center p-6 text-center text-xs text-muted-foreground">
        {problem}
      </div>
    );
  if (!colored.rows.length)
    return (
      <div className="grid h-full place-items-center text-xs text-muted-foreground">
        Keine Daten
      </div>
    );
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col gap-3 bg-card p-4">
      {HEADLINE.includes(chart) && (
        <div className="shrink-0 text-3xl font-semibold tracking-tight tabular-nums">
          {headlineFor(chart, colored.rows, colored.shape)}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Renderer rows={colored.rows} shape={colored.shape} options={OPTIONS} />
      </div>
      {legend.length > 0 && legend.length <= 24 && (
        <div className="max-h-28 shrink-0 overflow-auto">
          <LegendCards items={legend} columns={4} />
        </div>
      )}
    </div>
  );
}
