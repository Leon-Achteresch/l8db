import {
  type Agg,
  type ChartKind,
  COMPARE_COLOR,
  COMPARE_MARK,
  type DatasetShape,
  type DimKind,
  dimKind,
  fmtDim,
  type HeadlineMode,
  stepLabel,
  type TrendBucket,
  toLabel,
  toNumber,
  type WidgetOptions,
} from "@/lib/dashboards";
import {
  type ChartComparison,
  change,
  color,
  goodness,
  type Row,
  seriesColor,
} from "./chart-utils";

export interface Summary {
  value: number | null;
  text: string | null;
  percent: boolean;
  label: string | null;
  delta: number | null;
  deltaLabel: string | null;
  good: boolean | null;
}

export interface SummarySource {
  rows: Row[];
  totals?: Row | null;
}

export interface LegendItem {
  name: string;
  color: string;
  line?: boolean;
}

const GHOST_KINDS: ChartKind[] = ["kpi", "area", "line", "column", "bars"];
const LIST_KINDS: ChartKind[] = ["donut", "funnel", "table"];
const SERIES_KINDS: ChartKind[] = ["area", "line", "column", "radar"];

export function comparesIn(kind: ChartKind): boolean {
  return GHOST_KINDS.includes(kind) || LIST_KINDS.includes(kind);
}

export function timeKind(rows: Row[], shape: DatasetShape): DimKind {
  if (!shape.dimension) return "category";
  return dimKind(rows.slice(0, 400).map((row) => toLabel(row[shape.dimension as string])));
}

export function resolveHeadline(
  kind: ChartKind,
  options: WidgetOptions,
  time: boolean,
): Exclude<HeadlineMode, "auto"> {
  if (options.headline !== "auto") return options.headline;
  if (kind === "kpi" && time) return "last";
  if (kind === "scatter") return "average";
  return "total";
}

function stacked(kind: ChartKind, shape: DatasetShape, options: WidgetOptions): boolean {
  return (kind === "area" || kind === "column") && options.stacked && shape.metrics.length > 1;
}

export function focusKeys(kind: ChartKind, shape: DatasetShape, options: WidgetOptions): string[] {
  if (stacked(kind, shape, options)) return shape.metrics.map((m) => m.key);
  if (kind === "scatter") return shape.metrics[1] ? [shape.metrics[1].key] : [];
  return shape.metrics[0] ? [shape.metrics[0].key] : [];
}

function seriesValue(row: Row | undefined, keys: string[]): number | null {
  if (!row || !keys.some((key) => row[key] !== undefined && row[key] !== null)) return null;
  return keys.reduce((sum, key) => sum + toNumber(row[key]), 0);
}

function aggregate(
  source: SummarySource,
  keys: string[],
  mode: Exclude<HeadlineMode, "auto">,
  aggOf: (key: string) => Agg,
): number | null {
  const values = source.rows.map((row) => seriesValue(row, keys)).filter((v) => v !== null);
  if (!values.length) return null;
  switch (mode) {
    case "last":
      return values[values.length - 1];
    case "average":
      return values.reduce((s, v) => s + v, 0) / values.length;
    case "max":
      return Math.max(...values);
    case "min":
      return Math.min(...values);
  }
  if (source.totals && keys.every((key) => source.totals?.[key] !== undefined))
    return keys.reduce((sum, key) => sum + toNumber(source.totals?.[key]), 0);
  const agg = keys.length === 1 ? aggOf(keys[0]) : "sum";
  if (agg === "min") return Math.min(...values);
  if (agg === "max") return Math.max(...values);
  if (agg === "avg") return values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + v, 0);
}

function conversion(source: SummarySource, key: string): number | null {
  const first = toNumber(source.rows[0]?.[key]);
  const last = toNumber(source.rows[source.rows.length - 1]?.[key]);
  return source.rows.length > 1 && first ? (last / first) * 100 : null;
}

function grade(rows: Row[], shape: DatasetShape): string {
  const [mv, mm] = shape.metrics;
  const total = rows.reduce((s, r) => s + toNumber(r[mv?.key ?? ""]), 0);
  const max = rows.reduce((s, r) => s + toNumber(r[mm?.key ?? ""]), 0) || 1;
  const pct = Math.round((total / max) * 100);
  return pct >= 90 ? "Exzellent" : pct >= 70 ? "Gut" : pct >= 50 ? "Okay" : "Schwach";
}

export function summarize({
  kind,
  shape,
  options,
  current,
  previous,
  previousLabel,
  stepLabel,
  aggOf,
}: {
  kind: ChartKind;
  shape: DatasetShape;
  options: WidgetOptions;
  current: SummarySource;
  previous: SummarySource | null;
  previousLabel: string | null;
  stepLabel: string;
  aggOf: (key: string) => Agg;
}): Summary {
  const empty: Summary = {
    value: null,
    text: null,
    percent: false,
    label: null,
    delta: null,
    deltaLabel: null,
    good: null,
  };
  if (kind === "table") return empty;
  if (kind === "score") return { ...empty, text: grade(current.rows, shape) };
  if (kind === "gauge") return empty;
  const time = timeKind(current.rows, shape) !== "category";
  const keys = focusKeys(kind, shape, options);
  if (!keys.length) return empty;
  const funnel = kind === "funnel" && options.headline === "auto";
  const mode = resolveHeadline(kind, options, time);
  const measure = (source: SummarySource) =>
    funnel ? conversion(source, keys[0]) : aggregate(source, keys, mode, aggOf);
  const value = measure(current);
  const label = funnel
    ? "Konversion"
    : keys.length === 1 && shape.metrics.length > 1
      ? (shape.metrics.find((m) => m.key === keys[0])?.label ?? null)
      : null;
  let delta: number | null = null;
  let deltaLabel: string | null = null;
  if (value !== null && mode !== "last" && previous?.rows.length) {
    const before = measure(previous);
    if (before !== null && (funnel || before !== 0)) {
      delta = funnel ? value - before : ((value - before) / Math.abs(before)) * 100;
      deltaLabel = previousLabel;
    }
  } else if (
    value !== null &&
    mode === "last" &&
    time &&
    options.sortBy === "none" &&
    current.rows.length > 1
  ) {
    const before = seriesValue(current.rows[current.rows.length - 2], keys);
    if (before) {
      delta = ((value - before) / Math.abs(before)) * 100;
      deltaLabel = stepLabel;
    }
  }
  return {
    ...empty,
    value,
    percent: funnel,
    label,
    delta,
    deltaLabel,
    good: goodness(delta, options.invertDelta),
  };
}

export function alignComparison(rows: Row[], previous: Row[], shape: DatasetShape): Row[] {
  const dim = shape.dimension;
  if (!dim) return rows.map((_, i) => previous[i] ?? {});
  if (timeKind(rows, shape) === "category") {
    const byLabel = new Map(previous.map((row) => [toLabel(row[dim]), row]));
    return rows.map((row) => byLabel.get(toLabel(row[dim])) ?? {});
  }
  const ordered = (list: Row[]) =>
    [...list].sort((a, b) => toLabel(a[dim]).localeCompare(toLabel(b[dim])));
  const current = ordered(rows);
  const before = ordered(previous);
  const offset = before.length - current.length;
  const matched = new Map(current.map((row, i) => [row, before[i + offset] ?? {}]));
  return rows.map((row) => matched.get(row) ?? {});
}

export function buildComparison(
  kind: ChartKind,
  rows: Row[],
  previous: Row[],
  shape: DatasetShape,
  options: WidgetOptions,
  label: string,
  short: string,
): ChartComparison | null {
  if (!comparesIn(kind) || !previous.length) return null;
  const aligned = alignComparison(rows, previous, shape);
  const keys = focusKeys(kind, shape, options);
  return {
    rows: aligned,
    values: aligned.map((row) => seriesValue(row, keys)),
    label,
    short,
  };
}

export function legendFor(
  kind: ChartKind,
  rows: Row[],
  shape: DatasetShape,
  options: WidgetOptions,
  compare: ChartComparison | null = null,
): LegendItem[] {
  const items: LegendItem[] = [];
  const count = shape.metrics.length;
  if (SERIES_KINDS.includes(kind) && count > 1)
    items.push(
      ...shape.metrics.map((m, i) => ({
        name: m.label,
        color: seriesColor(i, count, options),
        line: kind === "line",
      })),
    );
  if (kind === "scatter" && shape.dimension) {
    const groups = [...new Set(rows.map((r) => toLabel(r[shape.dimension as string])))];
    if (groups.length > 1 && groups.length <= 12)
      items.push(...groups.map((name, i) => ({ name, color: color(i + options.colorOffset) })));
  }
  if (compare && GHOST_KINDS.includes(kind) && kind !== "kpi")
    items.push({
      name: compare.short,
      color: kind === "column" || kind === "bars" ? COMPARE_MARK : COMPARE_COLOR,
      line: true,
    });
  return items;
}

export function trendStep(
  rows: Row[],
  shape: DatasetShape,
  options: WidgetOptions,
  bucket: TrendBucket,
  current: string,
): Pick<Summary, "delta" | "deltaLabel" | "good"> | null {
  const dim = shape.dimension;
  const key = shape.metrics[0]?.key;
  if (!dim || !key) return null;
  const iso = (row: Row) => toLabel(row[dim]).replace(/^(\d{4}-\d{2})$/, "$1-01");
  const done = rows.filter((row) => iso(row) < current);
  if (done.length < 2) return null;
  const last = done[done.length - 1];
  const delta = change(toNumber(last[key]), toNumber(done[done.length - 2][key]));
  if (delta === null) return null;
  const kind = dimKind([iso(last)], bucket);
  const name = fmtDim(iso(last), kind);
  return {
    delta,
    deltaLabel: `${kind === "week" ? `Woche ab ${name}` : name} ${stepLabel(kind)}`,
    good: goodness(delta, options.invertDelta),
  };
}
