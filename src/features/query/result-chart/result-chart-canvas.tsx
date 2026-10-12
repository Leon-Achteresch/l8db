import { type Ref, useMemo } from "react";
import {
  CHART_RENDERERS,
  ChartHeadline,
  ChartLegend,
  legendFor,
  summarize,
  timeKind,
} from "@/features/dashboard/charts";
import {
  type ChartKind,
  chartFits,
  colorSeries,
  DEFAULT_OPTIONS,
  stepLabel,
} from "@/lib/dashboards";
import type { ResultChartData } from "@/lib/result-chart";
import { cn } from "@/lib/utils";

const OPTIONS = { ...DEFAULT_OPTIONS, showDelta: false, showPeriod: false };
const HEADLINE: ChartKind[] = ["kpi", "gauge", "score"];

export function ResultChartCanvas({
  chart,
  data,
  ref,
  legend: showLegend = true,
  className,
}: {
  chart: ChartKind;
  data: ResultChartData;
  ref?: Ref<HTMLDivElement>;
  legend?: boolean;
  className?: string;
}) {
  const colored = useMemo(() => colorSeries(chart, data.shape, data.rows), [chart, data]);
  const problem = chartFits(chart, colored.shape);
  const legend = useMemo(
    () => (problem ? [] : legendFor(chart, colored.rows, colored.shape, OPTIONS)),
    [problem, chart, colored],
  );
  const summary = useMemo(
    () =>
      problem || !HEADLINE.includes(chart)
        ? null
        : summarize({
            kind: chart,
            shape: colored.shape,
            options: OPTIONS,
            current: { rows: colored.rows },
            previous: null,
            previousLabel: null,
            stepLabel: stepLabel(timeKind(colored.rows, colored.shape)),
            aggOf: () => "sum",
          }),
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
    <div ref={ref} className={cn("flex h-full min-h-0 flex-col gap-3 bg-card p-4", className)}>
      {summary && (summary.value !== null || summary.text) && (
        <ChartHeadline summary={summary} options={OPTIONS} className="shrink-0" />
      )}
      {showLegend && legend.length > 0 && legend.length <= 24 && (
        <ChartLegend items={legend} className="max-h-16 shrink-0 overflow-auto" />
      )}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Renderer rows={colored.rows} shape={colored.shape} options={OPTIONS} />
      </div>
    </div>
  );
}
