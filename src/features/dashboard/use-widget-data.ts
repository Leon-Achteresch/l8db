import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveConnection } from "@/lib/connections";
import {
  applyOptions,
  chartFits,
  colorSeries,
  compareLabel,
  compareShortLabel,
  comparisonRange,
  type Dataset,
  datasetMetricAggs,
  datasetShape,
  datasetSql,
  datasetTotalsSql,
  needsTotals,
  type Period,
  seriesGroups,
  stepLabel,
  type Widget,
  widgetOptions,
} from "@/lib/dashboards";
import type { QueryResult } from "@/lib/db";
import {
  buildComparison,
  legendFor,
  resolveHeadline,
  summarize,
  timeKind,
} from "./charts/chart-summary";
import type { Row } from "./charts/chart-utils";
import { useDashboardScope } from "./dashboard-scope";
import { useDebounced, useSqlQuery } from "./use-dataset-query";

const EMPTY_ROWS: Row[] = [];
const NO_COMPARE = ["gauge", "score"];

export function useWidgetData({
  widget,
  dataset,
  period,
  query,
  refreshMs = 0,
  debounceMs = 0,
}: {
  widget: Widget;
  dataset: Dataset | null;
  period: Period;
  query: UseQueryResult<QueryResult>;
  refreshMs?: number;
  debounceMs?: number;
}) {
  const connection = useActiveConnection();
  const scope = useDashboardScope();
  const kind = connection?.kind ?? null;
  const options = useMemo(() => widgetOptions(widget), [widget]);
  const baseShape = useMemo(() => (dataset ? datasetShape(dataset) : null), [dataset]);
  const rawRows = query.data?.rows ?? EMPTY_ROWS;
  const current = useMemo(() => {
    if (!baseShape) return null;
    const applied = applyOptions(baseShape, rawRows, options);
    return { ...colorSeries(widget.chart, applied.shape, applied.rows), applied };
  }, [baseShape, rawRows, options, widget.chart]);
  const shape = current?.shape ?? null;
  const rows = current?.rows ?? EMPTY_ROWS;
  const problem = shape ? chartFits(widget.chart, shape) : "Kein Datensatz zugewiesen";
  const comparable = Boolean(dataset && baseShape?.hasDate && !NO_COMPARE.includes(widget.chart));
  const range = useMemo(
    () => (comparable ? comparisonRange(period, options.compare) : null),
    [comparable, period, options.compare],
  );
  const time = shape ? timeKind(rows, shape) : "category";
  const mode = resolveHeadline(widget.chart, options, time !== "category");
  const totals =
    dataset && options.showValue && mode === "total" && query.isSuccess
      ? needsTotals(dataset, rawRows.length)
      : false;
  const previousSql = useDebounced(
    dataset && range && !problem ? datasetSql(dataset, kind, period, scope, range) : "",
    debounceMs,
  );
  const totalsSql = useDebounced(
    dataset && totals ? datasetTotalsSql(dataset, kind, period, scope) : "",
    debounceMs,
  );
  const previousTotalsSql = useDebounced(
    dataset && totals && range ? datasetTotalsSql(dataset, kind, period, scope, range) : "",
    debounceMs,
  );
  const previous = useSqlQuery(previousSql, refreshMs);
  const totalsQuery = useSqlQuery(totalsSql, refreshMs);
  const previousTotals = useSqlQuery(previousTotalsSql, refreshMs);
  const previousRows = previous.data?.rows ?? null;

  const view = useMemo(() => {
    if (!shape || !current || !dataset || problem) return null;
    const label = range && period !== "all" ? compareLabel(period, options.compare) : null;
    const short = range && period !== "all" ? compareShortLabel(period, options.compare) : "";
    const before =
      range && previousRows
        ? colorSeries(
            widget.chart,
            current.applied.shape,
            previousRows,
            seriesGroups(current.applied.shape, current.applied.rows),
          ).rows
        : null;
    const compare =
      before && label
        ? buildComparison(widget.chart, rows, before, shape, options, label, short)
        : null;
    const aggs = datasetMetricAggs(dataset);
    const keys = datasetShape(dataset).metrics.map((m) => m.key);
    const summary = summarize({
      kind: widget.chart,
      shape,
      options,
      current: { rows, totals: totalsQuery.data?.rows[0] ?? null },
      previous: range
        ? { rows: before ?? EMPTY_ROWS, totals: previousTotals.data?.rows[0] ?? null }
        : null,
      previousLabel: label,
      stepLabel: stepLabel(time),
      aggOf: (key) => aggs[keys.indexOf(key)] ?? "sum",
    });
    const legend = options.showLegend ? legendFor(widget.chart, rows, shape, options, compare) : [];
    return { compare, summary, legend };
  }, [
    shape,
    current,
    dataset,
    problem,
    range,
    period,
    options,
    previousRows,
    widget.chart,
    rows,
    totalsQuery.data,
    previousTotals.data,
    time,
  ]);

  return {
    options,
    shape,
    rows,
    problem,
    compare: view?.compare ?? null,
    summary: view?.summary ?? null,
    legend: view?.legend ?? [],
    summaryPending:
      (Boolean(totalsSql) && totalsQuery.isPending) ||
      (Boolean(previousTotalsSql) && previousTotals.isPending),
  };
}
