import {
  type DatasetShape,
  PALETTE,
  toLabel,
  toNumber,
  type WidgetOptions,
} from "@/lib/dashboards";

export type Row = Record<string, unknown>;

export interface ChartProps {
  rows: Row[];
  shape: DatasetShape;
  options: WidgetOptions;
}

export const axisTick = { fontSize: 11, fill: "var(--muted-foreground)" } as const;

export const tooltipStyle = {
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "var(--card)",
  color: "var(--card-foreground)",
  fontSize: 12,
  boxShadow: "0 8px 24px rgb(0 0 0 / 0.08)",
} as const;

export function color(index: number): string {
  return PALETTE[index % PALETTE.length];
}

export function categories(rows: Row[], shape: DatasetShape, offset = 0, metricIndex = 0) {
  const key = shape.metrics[metricIndex]?.key ?? "";
  return rows.map((row, i) => ({
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
