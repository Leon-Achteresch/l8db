import {
  type Agg,
  type DatasetMetric,
  isDateType,
  isNumericType,
  type SimpleDataset,
} from "@/lib/dashboards";
import type { DatasetColumn } from "./use-dataset-query";

export type ChartFieldTarget = "metric" | "dimension" | "dimension2" | "filter";
export const CHART_FIELD_MIME = "application/x-l8db-chart-field";

export function fieldTypeLabel(type: string): string {
  return isNumericType(type) ? "Zahl" : isDateType(type) ? "Datum" : "Text";
}

export function fieldAggregations(type: string): Agg[] {
  return isNumericType(type)
    ? ["sum", "avg", "count_distinct", "min", "max", "none", "count"]
    : ["count_distinct", "count", "none"];
}

export function updateChartMetric(
  metric: DatasetMetric,
  patch: Partial<DatasetMetric>,
): DatasetMetric {
  const initialLabel =
    metric.agg === "count" && metric.column === null && metric.label === "Anzahl";
  const changedField = "column" in patch && patch.column !== metric.column;
  const changedCalculation = "agg" in patch && patch.agg !== metric.agg;
  return {
    ...metric,
    ...patch,
    ...(initialLabel && (changedField || changedCalculation) && !("label" in patch)
      ? { label: "" }
      : {}),
  };
}

export function assignChartField(
  simple: SimpleDataset,
  field: DatasetColumn,
  target: Exclude<ChartFieldTarget, "filter">,
  metricId: string,
): SimpleDataset {
  if (target === "dimension") {
    const dated = isDateType(field.type);
    return {
      ...simple,
      dimension: { column: field.ref, bucket: dated ? "month" : "none" },
      dimension2: simple.dimension2 === field.ref ? null : simple.dimension2,
      dateColumn: dated && !simple.dateColumn ? field.ref : simple.dateColumn,
      sort: dated ? "dimension" : "metric_desc",
    };
  }
  if (target === "dimension2") {
    if (simple.dimension?.column === field.ref) return simple;
    return { ...simple, dimension2: field.ref };
  }
  const agg = isNumericType(field.type) ? "sum" : "count_distinct";
  if (simple.metrics.some((metric) => metric.column === field.ref && metric.agg === agg))
    return simple;
  const metric: DatasetMetric = { id: metricId, agg, column: field.ref, label: "" };
  const initialCount =
    simple.metrics.length === 1 &&
    simple.metrics[0].agg === "count" &&
    simple.metrics[0].column === null &&
    simple.metrics[0].label === "Anzahl";
  return { ...simple, metrics: initialCount ? [metric] : [...simple.metrics, metric] };
}
