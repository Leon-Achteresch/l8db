import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { confirmExpertSql } from "@/lib/dashboard-file";
import {
  CHARTS,
  createId,
  type Dashboard,
  type Dataset,
  settle,
  type Widget,
} from "@/lib/dashboards";

export interface ChartFile {
  format: "l8db-chart";
  version: 1;
  name: string;
  dataset: Dataset;
  widget: Widget;
}

export function makeChartFile(
  widget: Widget,
  dataset: Dataset,
  name = widget.title || dataset.name,
): ChartFile {
  const source = structuredClone(dataset);
  source.id = "source";
  return {
    format: "l8db-chart",
    version: 1,
    name,
    dataset: source,
    widget: { ...structuredClone(widget), id: "chart", datasetId: source.id, x: 0, y: 0 },
  };
}

export function parseChartFile(text: string): ChartFile {
  const value = JSON.parse(text) as ChartFile;
  if (
    value?.format !== "l8db-chart" ||
    value.version !== 1 ||
    typeof value.name !== "string" ||
    !value.widget ||
    !Object.hasOwn(CHARTS, value.widget.chart) ||
    !value.dataset ||
    !["simple", "expert", "flow"].includes(value.dataset.mode) ||
    !value.dataset.simple ||
    !Array.isArray(value.dataset.simple.metrics) ||
    !Array.isArray(value.dataset.simple.filters) ||
    !value.dataset.mapping ||
    !Array.isArray(value.dataset.mapping.metrics)
  )
    throw new Error("Die Datei enthält keinen gültigen l8db-Chart.");
  const s = value.dataset.simple;
  if (
    typeof s.schema !== "string" ||
    typeof s.table !== "string" ||
    typeof value.dataset.name !== "string" ||
    typeof value.dataset.sql !== "string" ||
    !Number.isFinite(s.limit) ||
    !s.metrics.every(
      (m) =>
        m &&
        typeof m.id === "string" &&
        ["count", "count_distinct", "sum", "avg", "min", "max", "none"].includes(m.agg) &&
        (m.column === null || typeof m.column === "string"),
    ) ||
    !s.filters.every(
      (f) =>
        f &&
        typeof f.id === "string" &&
        typeof f.column === "string" &&
        typeof f.operator === "string" &&
        typeof f.value === "string",
    )
  )
    throw new Error("Die Datenquelle des Charts ist unvollständig.");
  const def = CHARTS[value.widget.chart];
  return {
    ...value,
    widget: {
      ...value.widget,
      title: typeof value.widget.title === "string" ? value.widget.title : value.name,
      w: Number.isFinite(value.widget.w) ? Math.min(12, Math.max(2, value.widget.w)) : def.w,
      h: Number.isFinite(value.widget.h) ? Math.min(40, Math.max(3, value.widget.h)) : def.h,
      period: value.widget.period ?? "all",
    },
  };
}

export function confirmChartSql(chart: ChartFile): boolean {
  return confirmExpertSql({
    name: chart.name,
    datasets: [chart.dataset],
    widgets: [chart.widget],
    refreshSec: 0,
    locked: false,
  });
}

export function insertChartFile(
  dashboard: Dashboard,
  chart: ChartFile,
): { dataset: Dataset; widget: Widget } {
  const dataset = { ...structuredClone(chart.dataset), id: createId() };
  const widget = settle(
    {
      ...structuredClone(chart.widget),
      id: createId(),
      datasetId: dataset.id,
      title: chart.name,
      x: 0,
      y: 0,
    },
    dashboard.widgets,
  );
  return { dataset, widget };
}

export async function pickAndReadChart(): Promise<ChartFile | null> {
  const path = await open({
    multiple: false,
    directory: false,
    filters: [{ name: "l8db-Chart", extensions: ["json"] }],
  });
  return typeof path === "string" ? parseChartFile(await readTextFile(path)) : null;
}

export async function pickAndWriteChart(chart: ChartFile): Promise<string | null> {
  const path = await save({
    defaultPath: `${chart.name.replace(/[^\w-]+/g, "_") || "chart"}.chart.json`,
    filters: [{ name: "l8db-Chart", extensions: ["json"] }],
  });
  if (path) await writeTextFile(path, `${JSON.stringify(chart, null, 2)}\n`);
  return path;
}
