import {
  type ChartKind,
  type DatasetShape,
  fmtNumber,
  toLabel,
  toNumber,
  type WidgetOptions,
} from "@/lib/dashboards";
import { categories, color, type Row } from "./chart-utils";

export function legendFor(
  kind: ChartKind,
  rows: Row[],
  shape: DatasetShape,
  options: WidgetOptions,
) {
  const sum = (key: string) => rows.reduce((s, r) => s + toNumber(r[key]), 0);
  if (kind === "column" && shape.metrics.length > 1)
    return shape.metrics.map((m, i) => ({
      name: m.label,
      value: fmtNumber(sum(m.key)),
      color: color(i + options.colorOffset),
    }));
  switch (kind) {
    case "area":
    case "line":
      return shape.metrics.map((m, i) => ({
        name: m.label,
        value: fmtNumber(sum(m.key)),
        color: color(i + options.colorOffset),
      }));
    case "scatter": {
      const y = shape.metrics[1]?.key ?? "";
      const groups = new Map<string, number[]>();
      for (const r of rows) {
        const k = shape.dimension ? toLabel(r[shape.dimension]) : "Alle";
        groups.set(k, [...(groups.get(k) ?? []), toNumber(r[y])]);
      }
      return [...groups.entries()].map(([name, list], i) => ({
        name: `${name} · Ø`,
        value: fmtNumber(list.reduce((s, v) => s + v, 0) / Math.max(1, list.length)),
        color: color(i + options.colorOffset),
      }));
    }
    case "score": {
      const [mv, mm] = shape.metrics;
      return rows.map((r, i) => ({
        name: shape.dimension ? toLabel(r[shape.dimension]) : `#${i + 1}`,
        value: `${fmtNumber(toNumber(r[mv?.key ?? ""]))}/${fmtNumber(toNumber(r[mm?.key ?? ""]))}`,
        color: color(i + options.colorOffset),
      }));
    }
    case "kpi":
    case "sankey":
    case "gauge":
    case "heatmap":
    case "table":
      return [];
    default:
      return categories(rows, shape, options.colorOffset).map((c) => ({
        ...c,
        value: fmtNumber(c.value),
      }));
  }
}

export function headlineFor(kind: ChartKind, rows: Row[], shape: DatasetShape): string {
  if (kind === "table") return `${rows.length} Zeilen`;
  const key = shape.metrics[0]?.key ?? "";
  if (!rows.length || !key) return "—";
  if (kind === "gauge") {
    const max = rows.reduce((s, r) => s + toNumber(r[shape.metrics[1]?.key ?? ""]), 0) || 1;
    return `${Math.round((rows.reduce((s, r) => s + toNumber(r[key]), 0) / max) * 100)}%`;
  }
  if (kind === "score") {
    const total = rows.reduce((s, r) => s + toNumber(r[key]), 0);
    const max = rows.reduce((s, r) => s + toNumber(r[shape.metrics[1]?.key ?? ""]), 0) || 1;
    const pct = Math.round((total / max) * 100);
    return pct >= 90 ? "Exzellent" : pct >= 70 ? "Gut" : pct >= 50 ? "Okay" : "Schwach";
  }
  if (kind === "scatter") {
    const y = shape.metrics[1]?.key ?? key;
    return fmtNumber(rows.reduce((s, r) => s + toNumber(r[y]), 0) / rows.length);
  }
  if (kind === "funnel" || kind === "bars")
    return fmtNumber(Math.max(...rows.map((r) => toNumber(r[key]))));
  if (kind === "kpi" && !shape.dimension) return fmtNumber(toNumber(rows[0][key]));
  const keys =
    kind === "area" || kind === "line" || kind === "column" || kind === "radar"
      ? shape.metrics.map((m) => m.key)
      : [key];
  return fmtNumber(rows.reduce((s, r) => s + keys.reduce((t, k) => t + toNumber(r[k]), 0), 0));
}

export function deltaFor(rows: Row[], shape: DatasetShape, isTime: boolean): number | null {
  const key = shape.metrics[0]?.key ?? "";
  if (!isTime || rows.length < 2 || !key) return null;
  const last = toNumber(rows[rows.length - 1][key]);
  const prev = toNumber(rows[rows.length - 2][key]);
  if (!prev) return null;
  return ((last - prev) / Math.abs(prev)) * 100;
}
