import { CHARTS } from "./charts";
import { refLabel } from "./joins";
import { AGG_LABEL, type ChartKind, type Dataset, type Widget, type WidgetOptions } from "./model";
import { DIM_KEY, DIM2_KEY, metricKey } from "./sql";

export interface DatasetShape {
  dimension: string | null;
  dimension2: string | null;
  metrics: { key: string; label: string }[];
  hasDate: boolean;
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

export const ROW_COUNT_FIELD = "__l8db_row_count__";

export function colorSeries(
  kind: ChartKind,
  shape: DatasetShape,
  rows: Record<string, unknown>[],
): { shape: DatasetShape; rows: Record<string, unknown>[] } {
  if (!shape.dimension2 || !["column", "line", "area", "radar"].includes(kind))
    return { shape, rows };
  const groups = [...new Set(rows.map((r) => toLabel(r[shape.dimension2 as string])))];
  const metrics = groups.flatMap((group, index) =>
    shape.metrics.map((metric, m) => ({
      key: `series_${index}_${m}`,
      label: shape.metrics.length > 1 ? `${group} · ${metric.label}` : group,
    })),
  );
  const result = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const dim = shape.dimension ? row[shape.dimension] : "Gesamt";
    const key = JSON.stringify(dim);
    const target = result.get(key) ?? { [shape.dimension ?? "dim"]: dim };
    const group = groups.indexOf(toLabel(row[shape.dimension2]));
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
  while (others.some((o) => o.id !== w.id && overlaps(w, o))) w.y += 1;
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

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 2 });

export function fmtCompact(value: number): string {
  return compact.format(value);
}

export function fmtNumber(value: number): string {
  return full.format(value);
}
