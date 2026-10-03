import { type Dataset, datasetShape, type WidgetOptions } from "@/lib/dashboards";

export function retainChartMetricSelection(
  previous: Dataset,
  next: Dataset,
  options: Partial<WidgetOptions> | undefined,
): Partial<WidgetOptions> | undefined {
  if (!options?.metricKeys) return options;
  const previousShape = datasetShape(previous);
  const nextShape = datasetShape(next);
  const previousMetrics = previous.simple.metrics.filter(
    (metric) => metric.agg === "count" || metric.column,
  );
  const nextMetrics = next.simple.metrics.filter(
    (metric) => metric.agg === "count" || metric.column,
  );
  const keys = options.metricKeys.flatMap((key) => {
    if (previous.mode !== next.mode) return [];
    if (next.mode === "expert")
      return nextShape.metrics.some((metric) => metric.key === key) ? [key] : [];
    const index = previousShape.metrics.findIndex((metric) => metric.key === key);
    const id = previousMetrics[index]?.id;
    const nextIndex = id ? nextMetrics.findIndex((metric) => metric.id === id) : -1;
    const nextKey = nextShape.metrics[nextIndex]?.key;
    return nextKey ? [nextKey] : [];
  });
  return { ...options, metricKeys: keys.length ? keys : null };
}
