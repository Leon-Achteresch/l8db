import {
  ACCENT,
  type DatasetShape,
  type DimKind,
  dimKind,
  fmtDim,
  fmtDimLong,
  OTHER_LABEL,
  PALETTE,
  type Period,
  toLabel,
  toNumber,
  type WidgetOptions,
} from "@/lib/dashboards";

export type Row = Record<string, unknown>;

export interface ChartComparison {
  rows: Row[];
  values: (number | null)[];
  label: string;
  short: string;
}

export interface ChartTotals {
  complete: boolean;
  pending: boolean;
  grand: Row | null;
  rows: Row[] | null;
  columns: Row[] | null;
}

export interface ChartProps {
  rows: Row[];
  shape: DatasetShape;
  options: WidgetOptions;
  compare?: ChartComparison | null;
  period?: Period;
  totals?: ChartTotals | null;
  interactive?: boolean;
}

export const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;
export const CHAR_WIDTH = 6.2;

export type AxisLabel = { pos: number; text: string; anchor?: "start" | "middle" | "end" };

export function xAxisLabels(
  labels: string[],
  x: (i: number) => number,
  spacing: number,
  right: number,
): AxisLabel[] {
  const longest = Math.max(0, ...labels.map((label) => label.length));
  const step = Math.max(1, Math.ceil((longest * CHAR_WIDTH + 16) / Math.max(spacing, 1)));
  return labels.flatMap((text, i) => {
    if (i % step !== 0) return [];
    const pos = x(i);
    const half = (text.length * CHAR_WIDTH) / 2;
    const anchor = pos - half < 0 ? "start" : pos + half > right ? "end" : "middle";
    return [{ pos, text, anchor }];
  });
}

export function color(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function accent(options: WidgetOptions): string {
  return options.colorOffset ? color(options.colorOffset) : ACCENT;
}

export const OTHER_COLOR = "var(--dash-other)";

export function seriesColor(index: number, shape: DatasetShape, options: WidgetOptions): string {
  if (shape.metrics.length === 1) return accent(options);
  return shape.metrics[index]?.label === OTHER_LABEL
    ? OTHER_COLOR
    : color(index + options.colorOffset);
}

export function categories(rows: Row[], shape: DatasetShape, offset = 0, metricIndex = 0) {
  const key = shape.metrics[metricIndex]?.key ?? "";
  return rows.map((row, i) => ({
    raw: shape.dimension ? row[shape.dimension] : undefined,
    name: shape.dimension ? toLabel(row[shape.dimension]) : `#${i + 1}`,
    value: toNumber(row[key]),
    color: color(i + offset),
  }));
}

export function series(rows: Row[], shape: DatasetShape) {
  return rows.map((row) => {
    const out: Row = { name: shape.dimension ? toLabel(row[shape.dimension]) : "" };
    for (const m of shape.metrics) out[m.key] = toNumber(row[m.key]);
    return out;
  });
}

export function dimensionLabels(names: string[]): {
  kind: DimKind;
  short: string[];
  long: string[];
} {
  const kind = dimKind(names);
  return {
    kind,
    short: names.map((name, i) => fmtDim(name, kind, i === 0)),
    long: names.map((name) => fmtDimLong(name, kind)),
  };
}

export function change(now: number, before: number | null | undefined): number | null {
  return before === null || before === undefined || before === 0
    ? null
    : ((now - before) / Math.abs(before)) * 100;
}

export function goodness(delta: number | null, invert: boolean): boolean | null {
  return delta === null || Math.abs(delta) < 0.05 ? null : delta > 0 !== invert;
}

export function hoveredIndex(target: EventTarget) {
  const index = (target as Element).closest?.("[data-index]")?.getAttribute("data-index");
  return index == null ? null : Number(index);
}

export function dimAttr(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}
