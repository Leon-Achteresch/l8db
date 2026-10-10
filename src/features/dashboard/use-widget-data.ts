import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";
import { useActiveConnection } from "@/lib/connections";
import {
  applyOptions,
  colorSeries,
  compareLabel,
  compareShortLabel,
  comparisonRange,
  currentBucketStart,
  type Dataset,
  DIM_KEY,
  datasetMarginSql,
  datasetMetricAggs,
  datasetShape,
  datasetSql,
  datasetTotalsSql,
  datasetTrendSql,
  needsTotals,
  type Period,
  seriesGroups,
  stepLabel,
  trendBucket,
  type Widget,
  widgetFits,
  widgetOptions,
} from "@/lib/dashboards";
import type { QueryResult } from "@/lib/db";
import {
  buildComparison,
  legendFor,
  resolveHeadline,
  summarize,
  timeKind,
  trendStep,
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
  const problem = shape ? widgetFits(widget.chart, shape) : "Kein Datensatz zugewiesen";
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
  const trend = Boolean(
    dataset && !problem && widget.chart === "kpi" && baseShape?.hasDate && !baseShape.dimension,
  );
  const trendSql = useDebounced(
    dataset && trend ? datasetTrendSql(dataset, kind, period, scope) : "",
    debounceMs,
  );
  const previousTrendSql = useDebounced(
    dataset && trend && range ? datasetTrendSql(dataset, kind, period, scope, range) : "",
    debounceMs,
  );
  const tabular = widget.chart === "table" || widget.chart === "pivot";
  const margins = Boolean(
    dataset?.mode === "simple" &&
      !problem &&
      options.totals &&
      baseShape?.dimension &&
      tabular &&
      !query.isError &&
      !datasetMetricAggs(dataset).includes("none"),
  );
  const exactNeeded = Boolean(
    margins && dataset && needsTotals(dataset, query.isSuccess ? rawRows.length : 0),
  );
  const pivotMargins =
    exactNeeded && query.isSuccess && widget.chart === "pivot" && Boolean(baseShape?.dimension2);
  const visible = useMemo(() => {
    if (!pivotMargins || !baseShape?.dimension || !baseShape.dimension2) return null;
    const unique = (key: string) => {
      const seen = new Map<string, unknown>();
      for (const row of rawRows) seen.set(JSON.stringify(row[key] ?? null), row[key] ?? null);
      return [...seen.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([, value]) => value);
    };
    return { rows: unique(baseShape.dimension), columns: unique(baseShape.dimension2) };
  }, [pivotMargins, baseShape, rawRows]);
  const grandSql = useDebounced(
    dataset && exactNeeded ? datasetTotalsSql(dataset, kind, period, scope) : "",
    debounceMs,
  );
  const rowMarginSql = useDebounced(
    dataset && visible ? datasetMarginSql(dataset, "rows", visible.rows, kind, period, scope) : "",
    debounceMs,
  );
  const columnMarginSql = useDebounced(
    dataset && visible
      ? datasetMarginSql(dataset, "columns", visible.columns, kind, period, scope)
      : "",
    debounceMs,
  );
  const grandQuery = useSqlQuery(grandSql, refreshMs);
  const rowMargins = useSqlQuery(rowMarginSql, refreshMs);
  const columnMargins = useSqlQuery(columnMarginSql, refreshMs);
  const trendQuery = useSqlQuery(trendSql, refreshMs);
  const previousTrend = useSqlQuery(previousTrendSql, refreshMs);
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
    const chartShape = trend ? { ...shape, dimension: DIM_KEY } : shape;
    const chartRows = trend ? (trendQuery.data?.rows ?? EMPTY_ROWS) : rows;
    const ghost = trend ? (previousTrend.data?.rows ?? null) : before;
    const compare =
      ghost && label
        ? buildComparison(widget.chart, chartRows, ghost, chartShape, options, label, short)
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
    const bucket = trendBucket(period);
    const step =
      trend && summary.delta === null
        ? trendStep(chartRows, chartShape, options, bucket, currentBucketStart(bucket))
        : null;
    const legend = options.showLegend ? legendFor(widget.chart, rows, shape, options, compare) : [];
    return {
      compare,
      summary: step ? { ...summary, ...step } : summary,
      legend,
      chartRows,
      chartShape,
    };
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
    trend,
    trendQuery.data,
    previousTrend.data,
  ]);

  const grandRow = grandQuery.data?.rows[0] ?? null;
  const rowMarginRows = rowMargins.data?.rows ?? null;
  const columnMarginRows = columnMargins.data?.rows ?? null;
  const failed =
    grandQuery.isError ||
    (Boolean(rowMarginSql) && rowMargins.isError) ||
    (Boolean(columnMarginSql) && columnMargins.isError);
  const margin = useMemo(() => {
    if (!margins || failed) return null;
    if (!exactNeeded)
      return { complete: true, pending: false, grand: null, rows: null, columns: null };
    if (!grandSql) return null;
    return {
      complete: false,
      pending:
        grandQuery.isPending ||
        (Boolean(rowMarginSql) && rowMargins.isPending) ||
        (Boolean(columnMarginSql) && columnMargins.isPending),
      grand: grandRow,
      rows: rowMarginRows,
      columns: columnMarginRows,
    };
  }, [
    margins,
    failed,
    exactNeeded,
    grandSql,
    rowMarginSql,
    columnMarginSql,
    grandQuery.isPending,
    rowMargins.isPending,
    columnMargins.isPending,
    grandRow,
    rowMarginRows,
    columnMarginRows,
  ]);

  return {
    margin,
    options,
    shape: view?.chartShape ?? shape,
    rows: view?.chartRows ?? rows,
    problem,
    chartPending: trend && Boolean(trendSql) && trendQuery.isPending,
    chartError: trend ? trendQuery.error : null,
    compare: view?.compare ?? null,
    summary: view?.summary ?? null,
    legend: view?.legend ?? [],
    bucket: trend
      ? trendBucket(period)
      : dataset?.mode === "simple"
        ? (dataset.simple.dimension?.bucket ?? null)
        : null,
    summaryPending:
      (Boolean(totalsSql) && totalsQuery.isPending) ||
      (Boolean(previousTotalsSql) && previousTotals.isPending),
  };
}
