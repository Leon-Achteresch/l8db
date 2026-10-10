import { CHARTS } from "./charts";
import { calcOf, refLabel } from "./joins";
import {
  AGG_LABEL,
  type Agg,
  type ChartKind,
  type Dataset,
  type Widget,
  type WidgetOptions,
} from "./model";
import { DIM_KEY, DIM2_KEY, metricKey } from "./sql";

export interface DatasetShape {
  dimension: string | null;
  dimension2: string | null;
  metrics: { key: string; label: string; agg?: Agg }[];
  hasDate: boolean;
}

export function additive(metric: { agg?: Agg }): boolean {
  return metric.agg === undefined || metric.agg === "sum" || metric.agg === "count";
}

export function combinable(metric: { agg?: Agg }): boolean {
  return additive(metric) || metric.agg === "min" || metric.agg === "max";
}

export function combineTotal(metric: { agg?: Agg } | undefined, values: unknown[]): number | null {
  if (!metric || !combinable(metric)) return null;
  let result: number | null = null;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = toNumber(value);
    if (result === null) result = number;
    else if (metric.agg === "min") result = Math.min(result, number);
    else if (metric.agg === "max") result = Math.max(result, number);
    else result += number;
  }
  return result;
}

export function datasetShape(ds: Dataset): DatasetShape {
  if (ds.mode === "expert")
    return {
      dimension: ds.mapping.dimension,
      dimension2: ds.mapping.dimension2,
      metrics: ds.mapping.metrics.map((key) => ({ key, label: key })),
      hasDate: Boolean(ds.mapping.dateColumn),
    };
  const s = ds.simple;
  const metrics = s.metrics.filter((m) => m.agg === "count" || m.column);
  return {
    dimension: s.dimension ? DIM_KEY : null,
    dimension2: s.dimension2 ? DIM2_KEY : null,
    metrics: metrics.map((m, i) => ({
      key: metricKey(i),
      agg: m.column && calcOf(m.column, s)?.aggregate ? "avg" : m.agg,
      label:
        m.label || (m.column ? `${AGG_LABEL[m.agg]} ${refLabel(m.column, s)}` : AGG_LABEL[m.agg]),
    })),
    hasDate: Boolean(s.dateColumn),
  };
}

export function applyOptions(
  shape: DatasetShape,
  rows: Record<string, unknown>[],
  options: WidgetOptions,
): { shape: DatasetShape; rows: Record<string, unknown>[] } {
  const keys = options.metricKeys;
  const metrics = keys
    ? keys
        .map((key) => shape.metrics.find((m) => m.key === key))
        .filter((m): m is DatasetShape["metrics"][number] => Boolean(m))
    : shape.metrics;
  const next = { ...shape, metrics: metrics.length ? metrics : shape.metrics };
  const first = next.metrics[0]?.key;
  const sorted =
    options.sortBy === "none" || !first
      ? rows
      : [...rows].sort((a, b) =>
          options.sortBy === "asc"
            ? toNumber(a[first]) - toNumber(b[first])
            : toNumber(b[first]) - toNumber(a[first]),
        );
  return { shape: next, rows: sorted };
}

export function chartFits(kind: ChartKind, shape: DatasetShape): string | null {
  const need = CHARTS[kind];
  if (need.dim === "required" && !shape.dimension) return "Braucht eine Aufteilung (Dimension)";
  if (need.dim === "two" && (!shape.dimension || !shape.dimension2))
    return "Braucht zwei Aufteilungen (Quelle und Ziel)";
  if (need.dim === "none" && shape.dimension) return "Funktioniert nur ohne Aufteilung";
  if (shape.metrics.length < need.metrics[0])
    return `Braucht mindestens ${need.metrics[0]} Kennzahl${need.metrics[0] > 1 ? "en" : ""}`;
  return null;
}

export function widgetFits(kind: ChartKind, shape: DatasetShape): string | null {
  if (kind === "kpi" && !shape.dimension && !shape.hasDate)
    return "Braucht eine Datumsspalte oder eine Aufteilung nach Zeit für den Verlauf";
  return chartFits(kind, shape);
}

export const ROW_COUNT_FIELD = "__l8db_row_count__";

export const MAX_SERIES = 8;
export const OTHER_LABEL = "Weitere";

export function seriesGroups(shape: DatasetShape, rows: Record<string, unknown>[]): string[] {
  if (!shape.dimension2) return [];
  const key = shape.metrics[0]?.key ?? "";
  const totals = new Map<string, number>();
  for (const row of rows) {
    const group = toLabel(row[shape.dimension2]);
    totals.set(group, (totals.get(group) ?? 0) + Math.abs(toNumber(row[key])));
  }
  if (totals.size <= MAX_SERIES) return [...totals.keys()];
  const top = new Set(
    [...totals]
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SERIES - 1)
      .map(([group]) => group),
  );
  return [...[...totals.keys()].filter((group) => top.has(group)), OTHER_LABEL];
}

export function colorSeries(
  kind: ChartKind,
  shape: DatasetShape,
  rows: Record<string, unknown>[],
  fixedGroups?: string[],
): { shape: DatasetShape; rows: Record<string, unknown>[] } {
  if (!shape.dimension2 || !["column", "line", "area", "radar"].includes(kind))
    return { shape, rows };
  const groups = fixedGroups ?? seriesGroups(shape, rows);
  const metrics = groups.flatMap((group, index) =>
    shape.metrics.map((metric, m) => ({
      key: `series_${index}_${m}`,
      label: shape.metrics.length > 1 ? `${group} · ${metric.label}` : group,
    })),
  );
  const other = groups.indexOf(OTHER_LABEL);
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const dim = shape.dimension ? row[shape.dimension] : "Gesamt";
    const key = JSON.stringify(dim);
    const target = result.get(key) ?? { [shape.dimension ?? "dim"]: dim };
    const found = groups.indexOf(toLabel(row[shape.dimension2]));
    const group = found < 0 ? other : found;
    if (group < 0) continue;
    shape.metrics.forEach((m, i) => {
      const k = `series_${group}_${i}`;
      target[k] = toNumber(target[k]) + toNumber(row[m.key]);
    });
    result.set(key, target);
  }
  return { shape: { ...shape, dimension2: null, metrics }, rows: [...result.values()] };
}

export function overlaps(a: Widget, b: Widget): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function settle(widget: Widget, others: Widget[]): Widget {
  const w = { ...widget };
  for (;;) {
    let nextY = w.y;
    for (const other of others) {
      if (other.id !== w.id && overlaps(w, other))
        nextY = Math.max(nextY, w.y + Math.ceil(other.y + other.h - w.y));
    }
    if (nextY === w.y) break;
    w.y = nextY;
  }
  return w;
}

export function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof value === "bigint") return Number(value);
  return 0;
}

export function toLabel(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const iso = value.match(/^(\d{4}-\d{2}-\d{2})(?:[T ]00:00:00(?:\.0+)?(?:Z|[+-]00:?00)?)?$/);
    return iso ? iso[1] : value;
  }
  return String(value);
}
