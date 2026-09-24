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

export function hoveredIndex(target: EventTarget) {
  const index = (target as Element).closest?.("[data-index]")?.getAttribute("data-index");
  return index == null ? null : Number(index);
}
