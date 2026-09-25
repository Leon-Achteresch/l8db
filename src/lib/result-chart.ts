import { type ChartFile, makeChartFile } from "@/lib/chart-file";
import {
  CHARTS,
  type ChartKind,
  createId,
  type Dataset,
  type DatasetShape,
  toLabel,
  toNumber,
  type Widget,
} from "@/lib/dashboards";
import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";

export type ResultAgg = "none" | "sum" | "avg" | "count" | "min" | "max";
export type ResultSort = "none" | "x_asc" | "x_desc" | "value_asc" | "value_desc";
export type ColumnRole = "number" | "date" | "text";

export interface ResultChartConfig {
  chart: ChartKind;
  x: string | null;
  y: string[];
  series: string | null;
  agg: ResultAgg;
  sort: ResultSort;
  topN: number | null;
}

export interface ResultChartState {
  view: "grid" | "chart";
  config: ResultChartConfig | null;
}

export interface ResultChartData {
  shape: DatasetShape;
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

export const RESULT_AGG_LABEL: Record<ResultAgg, string> = {
  none: "Keine",
  sum: "Summe",
  avg: "Durchschnitt",
  count: "Anzahl",
  min: "Minimum",
  max: "Maximum",
};

export const RESULT_SORT_LABEL: Record<ResultSort, string> = {
  none: "Wie Ergebnis",
  x_asc: "X aufsteigend",
  x_desc: "X absteigend",
  value_asc: "Wert aufsteigend",
  value_desc: "Wert absteigend",
};

export const MAX_CHART_POINTS = 2000;
const PROFILE_SAMPLE = 200;
const DATE_PATTERN =
  /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/;
const NUMBER_PATTERN = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function columnRole(values: unknown[]): ColumnRole {
  let seen = 0;
  let numbers = 0;
  let dates = 0;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    seen++;
    if (typeof value === "number" || typeof value === "bigint") numbers++;
    else if (typeof value === "string" && NUMBER_PATTERN.test(value.trim())) numbers++;
    else if (typeof value === "string" && DATE_PATTERN.test(value.trim())) dates++;
    if (seen >= PROFILE_SAMPLE) break;
  }
  if (!seen) return "text";
  if (numbers === seen) return "number";
  if (dates === seen) return "date";
  return "text";
}

export function profileColumns(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, ColumnRole> {
  const sample = rows.slice(0, PROFILE_SAMPLE);
  return Object.fromEntries(
    columns.map((column) => [column, columnRole(sample.map((row) => row[column]))]),
  );
}

function hasDuplicates(rows: Record<string, unknown>[], column: string): boolean {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = toLabel(row[column]);
    if (seen.has(key)) return true;
    seen.add(key);
  }
  return false;
}

export function suggestChart(
  columns: string[],
  rows: Record<string, unknown>[],
): ResultChartConfig {
  const roles = profileColumns(columns, rows);
  const numbers = columns.filter((c) => roles[c] === "number");
  const dates = columns.filter((c) => roles[c] === "date");
  const texts = columns.filter((c) => roles[c] === "text");
  const base = { series: null, sort: "none" as ResultSort, topN: null };
  if (rows.length === 1 && numbers.length)
    return { ...base, chart: "kpi", x: null, y: [numbers[0]], agg: "none" };
  if (dates.length && numbers.length)
    return {
      ...base,
      chart: "line",
      x: dates[0],
      y: numbers.slice(0, 3),
      agg: hasDuplicates(rows, dates[0]) ? "sum" : "none",
      sort: "x_asc",
    };
  if (texts.length && numbers.length)
    return {
      ...base,
      chart: "column",
      x: texts[0],
      y: numbers.slice(0, 1),
      agg: hasDuplicates(rows, texts[0]) ? "sum" : "none",
    };
  if (numbers.length >= 2)
    return { ...base, chart: "scatter", x: numbers[0], y: [numbers[1]], agg: "none" };
  if (texts.length || dates.length)
    return {
      ...base,
      chart: "column",
      x: texts[0] ?? dates[0],
      y: [],
      agg: "count",
      sort: "value_desc",
    };
  return { ...base, chart: "table", x: null, y: [], agg: "none" };
}

export function sanitizeConfig(config: ResultChartConfig, columns: string[]): ResultChartConfig {
  const has = (c: string | null) => (c && columns.includes(c) ? c : null);
  return {
    ...config,
    chart: Object.hasOwn(CHARTS, config.chart) ? config.chart : "column",
    x: has(config.x),
    series: has(config.series),
    y: config.y.filter((c) => columns.includes(c)),
    topN: config.topN && config.topN > 0 ? Math.floor(config.topN) : null,
  };
}

function isScatter(config: ResultChartConfig) {
  return config.chart === "scatter";
}

export function metricColumns(config: ResultChartConfig): string[] {
  if (isScatter(config)) return [config.x, ...config.y].filter((c): c is string => Boolean(c));
  return config.y;
}

function dimensionColumn(config: ResultChartConfig): string | null {
  return isScatter(config) ? config.series : config.x;
}

function seriesColumn(config: ResultChartConfig): string | null {
  return isScatter(config) ? null : config.series;
}

export function chartShape(config: ResultChartConfig): DatasetShape {
  const metrics = metricColumns(config);
  const counted = config.agg === "count" && metrics.length === 0;
  return {
    dimension: dimensionColumn(config) ? "dim" : null,
    dimension2: seriesColumn(config) ? "dim2" : null,
    metrics: counted
      ? [{ key: "m0", label: "Anzahl" }]
      : metrics.map((column, i) => ({
          key: `m${i}`,
          label: config.agg === "none" ? column : `${RESULT_AGG_LABEL[config.agg]} ${column}`,
        })),
    hasDate: false,
  };
}

interface Accumulator {
  dim: unknown;
  dim2: unknown;
  sum: number[];
  count: number[];
  min: number[];
  max: number[];
  rows: number;
}

function compareLabels(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const na = Number(a);
  const nb = Number(b);
  if (
    a !== null &&
    b !== null &&
    Number.isFinite(na) &&
    Number.isFinite(nb) &&
    a !== "" &&
    b !== ""
  )
    return na - nb;
  return toLabel(a).localeCompare(toLabel(b), "de", { numeric: true });
}

export function buildChartData(
  rows: Record<string, unknown>[],
  config: ResultChartConfig,
  maxPoints = MAX_CHART_POINTS,
): ResultChartData {
  const shape = chartShape(config);
  const metrics = metricColumns(config);
  const dimension = dimensionColumn(config);
  const series = seriesColumn(config);
  let out: Record<string, unknown>[];
  if (config.agg === "none") {
    out = rows.map((row) => {
      const next: Record<string, unknown> = {};
      if (dimension) next.dim = row[dimension];
      if (series) next.dim2 = row[series];
      metrics.forEach((column, i) => {
        next[`m${i}`] = toNumber(row[column]);
      });
      return next;
    });
  } else {
    const groups = new Map<string, Accumulator>();
    const width = Math.max(1, metrics.length);
    for (const row of rows) {
      const dim = dimension ? row[dimension] : null;
      const dim2 = series ? row[series] : null;
      const key = `${toLabel(dim)}\u0000${toLabel(dim2)}`;
      let acc = groups.get(key);
      if (!acc) {
        acc = {
          dim,
          dim2,
          sum: new Array(width).fill(0),
          count: new Array(width).fill(0),
          min: new Array(width).fill(Number.POSITIVE_INFINITY),
          max: new Array(width).fill(Number.NEGATIVE_INFINITY),
          rows: 0,
        };
        groups.set(key, acc);
      }
      acc.rows++;
      metrics.forEach((column, i) => {
        const raw = row[column];
        if (raw === null || raw === undefined || raw === "") return;
        const value = toNumber(raw);
        acc.sum[i] += value;
        acc.count[i]++;
        if (value < acc.min[i]) acc.min[i] = value;
        if (value > acc.max[i]) acc.max[i] = value;
      });
    }
    out = [...groups.values()].map((acc) => {
      const next: Record<string, unknown> = {};
      if (dimension) next.dim = acc.dim;
      if (series) next.dim2 = acc.dim2;
      if (!metrics.length) next.m0 = acc.rows;
      metrics.forEach((_, i) => {
        next[`m${i}`] =
          config.agg === "sum"
            ? acc.sum[i]
            : config.agg === "avg"
              ? acc.count[i]
                ? acc.sum[i] / acc.count[i]
                : 0
              : config.agg === "count"
                ? acc.count[i]
                : config.agg === "min"
                  ? Number.isFinite(acc.min[i])
                    ? acc.min[i]
                    : 0
                  : Number.isFinite(acc.max[i])
                    ? acc.max[i]
                    : 0;
      });
      return next;
    });
  }
  if (config.sort === "x_asc" || config.sort === "x_desc") {
    const direction = config.sort === "x_asc" ? 1 : -1;
    out.sort((a, b) => direction * compareLabels(a.dim, b.dim));
  } else if (config.sort === "value_asc" || config.sort === "value_desc") {
    const direction = config.sort === "value_asc" ? 1 : -1;
    out.sort((a, b) => direction * (toNumber(a.m0) - toNumber(b.m0)));
  }
  if (config.topN) out = out.slice(0, config.topN);
  const total = out.length;
  const truncated = total > maxPoints;
  return { shape, rows: truncated ? out.slice(0, maxPoints) : out, total, truncated };
}

function limitClause(kind: DatabaseKind | null, limit: number): { top: string; tail: string } {
  if (kind === "mssql") return { top: `TOP ${limit} `, tail: "" };
  if (kind === "oracle") return { top: "", tail: `\nFETCH FIRST ${limit} ROWS ONLY` };
  return { top: "", tail: `\nLIMIT ${limit}` };
}

export function resultChartDataset(
  config: ResultChartConfig,
  sql: string,
  kind: DatabaseKind | null,
  name: string,
): Dataset {
  const source = sql.trim().replace(/;+\s*$/, "");
  const metrics = metricColumns(config);
  const dimension = dimensionColumn(config);
  const series = seriesColumn(config);
  const base: Dataset = {
    id: createId(),
    name,
    mode: "expert",
    simple: {
      schema: "",
      table: "",
      join: null,
      joins: [],
      dimension: null,
      dimension2: null,
      metrics: [],
      filters: [],
      dateColumn: null,
      sort: "dimension",
      limit: 50,
    },
    sql: source,
    mapping: { dimension, dimension2: series, metrics, dateColumn: null },
  };
  const xSort = config.sort === "x_asc" || config.sort === "x_desc";
  if (config.agg === "none" && !config.topN && !xSort) return base;
  const style = identifierStyleForKind(kind);
  const q = (name: string) => quoteIdentifier(name, style);
  const select: string[] = [];
  const groups: string[] = [];
  if (dimension) {
    select.push(`${q(dimension)} AS ${q("dim")}`);
    groups.push(q(dimension));
  }
  if (series) {
    select.push(`${q(series)} AS ${q("dim2")}`);
    groups.push(q(series));
  }
  const aggregate = (column: string) =>
    config.agg === "none" ? q(column) : `${config.agg.toUpperCase()}(${q(column)})`;
  if (!metrics.length && config.agg !== "none") select.push(`COUNT(*) AS ${q("m0")}`);
  metrics.forEach((column, i) => {
    select.push(`${aggregate(column)} AS ${q(`m${i}`)}`);
  });
  const order =
    config.sort === "x_asc" && dimension
      ? `${q("dim")} ASC`
      : config.sort === "x_desc" && dimension
        ? `${q("dim")} DESC`
        : config.sort === "value_asc"
          ? `${q("m0")} ASC`
          : config.sort === "value_desc"
            ? `${q("m0")} DESC`
            : null;
  const limit = config.topN ? limitClause(kind, config.topN) : { top: "", tail: "" };
  const lines = [
    `SELECT ${limit.top}${select.join(", ")}`,
    `FROM (\n${source}\n) ${kind === "oracle" ? "" : "AS "}l8db_src`,
  ];
  if (config.agg !== "none" && groups.length) lines.push(`GROUP BY ${groups.join(", ")}`);
  if (order) lines.push(`ORDER BY ${order}`);
  return {
    ...base,
    sql: lines.join("\n") + limit.tail,
    mapping: {
      dimension: dimension ? "dim" : null,
      dimension2: series ? "dim2" : null,
      metrics: metrics.length
        ? metrics.map((_, i) => `m${i}`)
        : config.agg === "none"
          ? []
          : ["m0"],
      dateColumn: null,
    },
  };
}

export function resultChartFile(
  config: ResultChartConfig,
  sql: string,
  kind: DatabaseKind | null,
  name: string,
): ChartFile {
  const dataset = resultChartDataset(config, sql, kind, name);
  const def = CHARTS[config.chart];
  const widget: Widget = {
    id: createId(),
    chart: config.chart,
    datasetId: dataset.id,
    title: name,
    period: "all",
    options: {
      sortBy: config.sort === "value_asc" ? "asc" : config.sort === "value_desc" ? "desc" : "none",
    },
    x: 0,
    y: 0,
    w: def.w,
    h: def.h,
  };
  return makeChartFile(widget, dataset, name);
}
