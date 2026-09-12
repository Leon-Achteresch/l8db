import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import { buildFlowSql, type FlowGraph, flowShape } from "@/lib/dataset-flow";
import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier, type SqlIdentifierStyle } from "@/lib/export";
import { compileConditionExpression } from "@/lib/sql-filter";

export type Agg = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "none";
export type TimeBucket = "none" | "day" | "week" | "month" | "quarter" | "year";
export type DatasetMode = "simple" | "flow" | "expert";
export type SortMode = "dimension" | "metric_desc" | "metric_asc";
export type Period = "all" | "7d" | "30d" | "90d" | "quarter" | "year";
export type ChartKind =
  | "kpi"
  | "area"
  | "line"
  | "column"
  | "bars"
  | "funnel"
  | "donut"
  | "rings"
  | "radar"
  | "scatter"
  | "sankey"
  | "score"
  | "gauge"
  | "treemap"
  | "heatmap"
  | "table";

export interface WidgetOptions {
  showValue: boolean;
  showDelta: boolean;
  showLegend: boolean;
  showPeriod: boolean;
  metricKeys: string[] | null;
  colorOffset: number;
  stacked: boolean;
  curve: "monotone" | "linear";
  showGrid: boolean;
  showPercent: boolean;
  labels: boolean;
  sortBy: "none" | "asc" | "desc";
}

export const DEFAULT_OPTIONS: WidgetOptions = {
  showValue: true,
  showDelta: true,
  showLegend: true,
  showPeriod: true,
  metricKeys: null,
  colorOffset: 0,
  stacked: true,
  curve: "monotone",
  showGrid: true,
  showPercent: true,
  labels: false,
  sortBy: "none",
};

export function widgetOptions(widget: Pick<Widget, "options">): WidgetOptions {
  return { ...DEFAULT_OPTIONS, ...widget.options };
}

export const AGG_LABEL: Record<Agg, string> = {
  count: "Anzahl Zeilen",
  count_distinct: "Anzahl verschiedener Werte",
  sum: "Summe",
  avg: "Durchschnitt",
  min: "Minimum",
  max: "Maximum",
  none: "Einzelwert (keine Zusammenfassung)",
};

export const BUCKET_LABEL: Record<TimeBucket, string> = {
  none: "Exakter Wert",
  day: "Pro Tag",
  week: "Pro Woche",
  month: "Pro Monat",
  quarter: "Pro Quartal",
  year: "Pro Jahr",
};

export const PERIOD_LABEL: Record<Period, string> = {
  all: "Gesamt",
  "7d": "Letzte 7 Tage",
  "30d": "Letzte 30 Tage",
  "90d": "Letzte 90 Tage",
  quarter: "Dieses Quartal",
  year: "Dieses Jahr",
};

export const PALETTE = [
  "#a3e635",
  "#3b82f6",
  "#c084fc",
  "#f472b6",
  "#facc15",
  "#2dd4bf",
  "#fb923c",
  "#94a3b8",
];

export interface DatasetMetric {
  id: string;
  agg: Agg;
  column: string | null;
  label: string;
}

export interface DatasetFilter {
  id: string;
  column: string;
  operator: string;
  value: string;
  dataType?: string;
}

export interface DatasetJoin {
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
}

export interface SimpleDataset {
  schema: string;
  table: string;
  join: DatasetJoin | null;
  dimension: { column: string; bucket: TimeBucket } | null;
  dimension2: string | null;
  metrics: DatasetMetric[];
  filters: DatasetFilter[];
  dateColumn: string | null;
  sort: SortMode;
  limit: number;
}

export interface ExpertMapping {
  dimension: string | null;
  dimension2: string | null;
  metrics: string[];
  dateColumn: string | null;
}

export interface Dataset {
  id: string;
  name: string;
  mode: DatasetMode;
  simple: SimpleDataset;
  flow?: FlowGraph;
  sql: string;
  mapping: ExpertMapping;
}

export interface Widget {
  id: string;
  chart: ChartKind;
  datasetId: string | null;
  title: string;
  period: Period;
  options?: Partial<WidgetOptions>;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dashboard {
  id: string;
  connectionId: string;
  database: string | null;
  name: string;
  datasets: Dataset[];
  widgets: Widget[];
  refreshSec: number;
  locked: boolean;
  createdAt: number;
  filePath?: string | null;
  fileStamp?: string | null;
}

export const GRID_COLS = 12;
export function minSize(kind: ChartKind): { minW: number; minH: number } {
  return kind === "kpi" || kind === "gauge" ? { minW: 2, minH: 3 } : { minW: 3, minH: 5 };
}
export const ROW_HEIGHT = 44;
export const GRID_GAP = 12;
export const BASE_COL_WIDTH = 80;

export function rowHeightFor(width: number): number {
  const colWidth = (width - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  if (!(colWidth > 0)) return ROW_HEIGHT;
  const scale = Math.min(1.5, Math.max(0.7, colWidth / BASE_COL_WIDTH));
  return Math.round(ROW_HEIGHT * scale);
}

export interface ChartDef {
  label: string;
  hint: string;
  dim: "none" | "optional" | "required" | "two";
  metrics: [number, number];
  w: number;
  h: number;
  options: (keyof WidgetOptions)[];
}

const COMMON: (keyof WidgetOptions)[] = ["showValue", "showDelta", "showPeriod", "colorOffset"];

export const CHARTS: Record<ChartKind, ChartDef> = {
  kpi: {
    label: "Kennzahl",
    hint: "Eine große Zahl mit Trend",
    dim: "optional",
    metrics: [1, 1],
    w: 3,
    h: 4,
    options: [...COMMON, "curve"],
  },
  area: {
    label: "Verlauf",
    hint: "Flächen über eine Achse",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "stacked", "curve", "showGrid"],
  },
  line: {
    label: "Linien",
    hint: "Eine Linie je Kennzahl",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "curve", "showGrid", "labels"],
  },
  column: {
    label: "Säulen",
    hint: "Senkrechte Säulen je Kategorie",
    dim: "required",
    metrics: [1, 6],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "stacked", "showGrid", "labels", "sortBy"],
  },
  bars: {
    label: "Pipeline",
    hint: "Horizontale Balken mit Anteil",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 8,
    options: [...COMMON, "showLegend", "showPercent", "sortBy"],
  },
  funnel: {
    label: "Funnel",
    hint: "Stufen mit Prozentanteil",
    dim: "required",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "showPercent", "sortBy"],
  },
  donut: {
    label: "Donut",
    hint: "Anteile als Ring",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 8,
    options: [...COMMON, "showLegend", "showPercent", "sortBy"],
  },
  rings: {
    label: "Ringe",
    hint: "Konzentrische Ringe pro Kategorie",
    dim: "required",
    metrics: [1, 1],
    w: 4,
    h: 9,
    options: [...COMMON, "showLegend", "sortBy"],
  },
  radar: {
    label: "Radar",
    hint: "Netzdiagramm pro Kategorie",
    dim: "required",
    metrics: [1, 3],
    w: 4,
    h: 9,
    options: [...COMMON, "showLegend", "sortBy"],
  },
  scatter: {
    label: "Blasen",
    hint: "X, Y und Größe je Zeile, Farbe je Kategorie",
    dim: "optional",
    metrics: [2, 3],
    w: 6,
    h: 8,
    options: [...COMMON, "showLegend", "showGrid"],
  },
  sankey: {
    label: "Fluss",
    hint: "Verbindungen von Quelle zu Ziel",
    dim: "two",
    metrics: [1, 1],
    w: 6,
    h: 9,
    options: [...COMMON],
  },
  score: {
    label: "Score",
    hint: "Erreichte Punkte je Kategorie als Ring",
    dim: "required",
    metrics: [2, 2],
    w: 4,
    h: 7,
    options: [...COMMON, "showLegend"],
  },
  gauge: {
    label: "Tacho",
    hint: "Wert gegen Zielwert als Halbkreis",
    dim: "none",
    metrics: [2, 2],
    w: 3,
    h: 5,
    options: [...COMMON],
  },
  treemap: {
    label: "Treemap",
    hint: "Flächen proportional zum Wert",
    dim: "required",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "showLegend", "labels", "sortBy"],
  },
  heatmap: {
    label: "Heatmap",
    hint: "Zwei Aufteilungen als farbige Matrix",
    dim: "two",
    metrics: [1, 1],
    w: 6,
    h: 7,
    options: [...COMMON, "labels"],
  },
  table: {
    label: "Tabelle",
    hint: "Die Rohdaten als Tabelle",
    dim: "optional",
    metrics: [0, 6],
    w: 6,
    h: 7,
    options: ["showValue", "showPeriod"],
  },
};

export const OPTION_LABEL: Record<keyof WidgetOptions, string> = {
  showValue: "Kopfzahl anzeigen",
  showDelta: "Trend-Badge anzeigen",
  showLegend: "Legende anzeigen",
  showPeriod: "Zeitraum-Auswahl anzeigen",
  metricKeys: "Kennzahlen",
  colorOffset: "Startfarbe",
  stacked: "Gestapelt",
  curve: "Kurvenform",
  showGrid: "Gitterlinien",
  showPercent: "Prozentwerte anzeigen",
  labels: "Werte direkt am Chart",
  sortBy: "Sortierung",
};

export function chartNeeds(kind: ChartKind): string {
  const def = CHARTS[kind];
  const dim =
    def.dim === "two"
      ? "zwei Aufteilungen"
      : def.dim === "required"
        ? "eine Aufteilung"
        : def.dim === "optional"
          ? "optional eine Aufteilung"
          : "keine Aufteilung";
  const m =
    def.metrics[0] === def.metrics[1]
      ? `${def.metrics[0]} Kennzahl${def.metrics[0] === 1 ? "" : "en"}`
      : `${def.metrics[0]} bis ${def.metrics[1]} Kennzahlen`;
  return `${dim}, ${m}`;
}

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function emptySimple(): SimpleDataset {
  return {
    schema: "",
    table: "",
    join: null,
    dimension: null,
    dimension2: null,
    metrics: [{ id: createId(), agg: "count", column: null, label: "Anzahl" }],
    filters: [],
    dateColumn: null,
    sort: "dimension",
    limit: 50,
  };
}

export function emptyDataset(name: string): Dataset {
  return {
    id: createId(),
    name,
    mode: "simple",
    simple: emptySimple(),
    sql: "",
    mapping: { dimension: null, dimension2: null, metrics: [], dateColumn: null },
  };
}

export function isNumericType(type: string): boolean {
  return /int|numeric|decimal|float|double|real|money|number|serial/i.test(type);
}

export function isDateType(type: string): boolean {
  return /date|time/i.test(type);
}

export const JOIN_PREFIX = "join:";

export function joinRef(column: string): string {
  return `${JOIN_PREFIX}${column}`;
}

export function refLabel(ref: string, ds: SimpleDataset): string {
  return ref.startsWith(JOIN_PREFIX)
    ? `${ds.join?.table ?? "join"}.${ref.slice(JOIN_PREFIX.length)}`
    : ref;
}

function refExpr(ref: string, ds: SimpleDataset, style: SqlIdentifierStyle): string {
  const isJoin = ref.startsWith(JOIN_PREFIX);
  const name = quoteIdentifier(isJoin ? ref.slice(JOIN_PREFIX.length) : ref, style);
  if (!ds.join) return name;
  return `${isJoin ? "t2" : "t1"}.${name}`;
}

export function bucketExpr(col: string, bucket: TimeBucket, kind: DatabaseKind | null): string {
  if (bucket === "none") return col;
  switch (kind) {
    case "mysql": {
      const map: Record<Exclude<TimeBucket, "none">, string> = {
        day: `DATE(${col})`,
        week: `DATE_SUB(DATE(${col}), INTERVAL WEEKDAY(${col}) DAY)`,
        month: `DATE_FORMAT(${col}, '%Y-%m-01')`,
        quarter: `CONCAT(YEAR(${col}), '-Q', QUARTER(${col}))`,
        year: `DATE_FORMAT(${col}, '%Y-01-01')`,
      };
      return map[bucket];
    }
    case "sqlite":
    case "duckdb": {
      if (kind === "duckdb") return `date_trunc('${bucket}', ${col})`;
      const map: Record<Exclude<TimeBucket, "none">, string> = {
        day: `strftime('%Y-%m-%d', ${col})`,
        week: `strftime('%Y-W%W', ${col})`,
        month: `strftime('%Y-%m', ${col})`,
        quarter: `strftime('%Y', ${col}) || '-Q' || ((CAST(strftime('%m', ${col}) AS INTEGER) + 2) / 3)`,
        year: `strftime('%Y', ${col})`,
      };
      return map[bucket];
    }
    case "mssql":
      if (bucket === "day") return `CAST(${col} AS date)`;
      return `CAST(DATEADD(${bucket}, DATEDIFF(${bucket}, 0, ${col}), 0) AS date)`;
    case "oracle": {
      const fmt = { day: "DD", week: "IW", month: "MM", quarter: "Q", year: "YYYY" }[bucket];
      return `TRUNC(${col}, '${fmt}')`;
    }
    default:
      return `date_trunc('${bucket}', ${col})`;
  }
}

export function aggSql(agg: Agg, col: string): string {
  switch (agg) {
    case "count":
      return `COUNT(${col})`;
    case "count_distinct":
      return `COUNT(DISTINCT ${col})`;
    case "none":
      return col;
    default:
      return `${agg.toUpperCase()}(${col})`;
  }
}

function aggExpr(metric: DatasetMetric, ds: SimpleDataset, style: SqlIdentifierStyle): string {
  return aggSql(metric.agg, metric.column ? refExpr(metric.column, ds, style) : "*");
}

export function periodStart(period: Period, now = new Date()): string | null {
  const d = new Date(now);
  switch (period) {
    case "all":
      return null;
    case "7d":
      d.setDate(d.getDate() - 7);
      break;
    case "30d":
      d.setDate(d.getDate() - 30);
      break;
    case "90d":
      d.setDate(d.getDate() - 90);
      break;
    case "quarter":
      d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
      break;
    case "year":
      d.setMonth(0, 1);
      break;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateLiteral(iso: string, kind: DatabaseKind | null): string {
  return kind === "oracle" ? `DATE '${iso}'` : `'${iso}'`;
}

export const DIM_KEY = "dim";
export const DIM2_KEY = "dim2";
export function metricKey(index: number): string {
  return `m${index}`;
}

export function buildSimpleSql(
  ds: SimpleDataset,
  kind: DatabaseKind | null,
  period: Period = "all",
): string {
  if (!ds.table) return "";
  const style = identifierStyleForKind(kind);
  const q = (name: string) => quoteIdentifier(name, style);
  const table = (schema: string, name: string) => (schema ? `${q(schema)}.${q(name)}` : q(name));
  const select: string[] = [];
  const groups: string[] = [];
  if (ds.dimension) {
    const expr = bucketExpr(refExpr(ds.dimension.column, ds, style), ds.dimension.bucket, kind);
    select.push(`${expr} AS ${q(DIM_KEY)}`);
    groups.push(expr);
  }
  if (ds.dimension2) {
    const expr = refExpr(ds.dimension2, ds, style);
    select.push(`${expr} AS ${q(DIM2_KEY)}`);
    groups.push(expr);
  }
  const metrics = ds.metrics.filter((m) => m.agg === "count" || m.column);
  select.push(...metrics.map((m, i) => `${aggExpr(m, ds, style)} AS ${q(metricKey(i))}`));
  if (select.length === 0) select.push("*");
  const grouped = metrics.some((m) => m.agg !== "none") && groups.length > 0;
  if (grouped)
    groups.push(
      ...metrics.filter((m) => m.agg === "none" && m.column).map((m) => aggExpr(m, ds, style)),
    );
  const limit = Math.max(1, Math.floor(ds.limit || 50));
  const lines = [`SELECT ${kind === "mssql" ? `TOP ${limit} ` : ""}${select.join(", ")}`];
  lines.push(`FROM ${table(ds.schema, ds.table)}${ds.join ? " AS t1" : ""}`);
  if (ds.join)
    lines.push(
      `LEFT JOIN ${table(ds.join.schema, ds.join.table)} AS t2 ON t2.${q(ds.join.toColumn)} = t1.${q(ds.join.fromColumn)}`,
    );
  const where = ds.filters
    .filter((f) => f.column)
    .map((f) =>
      compileConditionExpression(
        refExpr(f.column, ds, style),
        f.operator,
        f.value,
        kind,
        f.dataType,
      ),
    )
    .filter((part): part is string => part !== null);
  const start = periodStart(period);
  if (ds.dateColumn && start)
    where.push(`${refExpr(ds.dateColumn, ds, style)} >= ${dateLiteral(start, kind)}`);
  if (where.length) lines.push(`WHERE ${where.join(" AND ")}`);
  if (grouped) lines.push(`GROUP BY ${groups.join(", ")}`);
  const orderTarget =
    ds.sort === "dimension"
      ? ds.dimension && grouped
        ? q(DIM_KEY)
        : null
      : metrics.length
        ? q(metricKey(0))
        : null;
  if (orderTarget)
    lines.push(`ORDER BY ${orderTarget} ${ds.sort === "metric_desc" ? "DESC" : "ASC"}`);
  if (kind === "oracle") lines.push(`FETCH FIRST ${limit} ROWS ONLY`);
  else if (kind !== "mssql") lines.push(`LIMIT ${limit}`);
  return lines.join("\n");
}

export function buildExpertSql(ds: Dataset, kind: DatabaseKind | null, period: Period): string {
  const sql = ds.sql.trim().replace(/;+\s*$/, "");
  const start = periodStart(period);
  if (!sql || !ds.mapping.dateColumn || !start) return sql;
  const style = identifierStyleForKind(kind);
  const col = quoteIdentifier(ds.mapping.dateColumn, style);
  return `SELECT * FROM (\n${sql}\n) ${kind === "oracle" ? "" : "AS "}q WHERE q.${col} >= ${dateLiteral(start, kind)}`;
}

export function datasetSql(ds: Dataset, kind: DatabaseKind | null, period: Period): string {
  if (ds.mode === "flow") return ds.flow ? buildFlowSql(ds.flow, kind, period) : "";
  return ds.mode === "simple"
    ? buildSimpleSql(ds.simple, kind, period)
    : buildExpertSql(ds, kind, period);
}

export interface DatasetShape {
  dimension: string | null;
  dimension2: string | null;
  metrics: { key: string; label: string }[];
  hasDate: boolean;
}

export function datasetShape(ds: Dataset): DatasetShape {
  if (ds.mode === "flow")
    return ds.flow
      ? flowShape(ds.flow)
      : { dimension: null, dimension2: null, metrics: [], hasDate: false };
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

interface DashboardsState {
  dashboards: Dashboard[];
  active: Record<string, string>;
  add: (connectionId: string, database: string | null, name?: string) => string;
  update: (id: string, patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string;
  setActive: (connectionId: string, id: string) => void;
  importDashboard: (
    dashboard: Partial<Dashboard>,
    connectionId: string,
    database: string | null,
  ) => string;
}

export const useDashboardsStore = create<DashboardsState>()(
  persist(
    (set, get) => ({
      dashboards: [],
      active: {},
      add: (connectionId, database, name) => {
        const id = createId();
        const count = get().dashboards.filter((d) => d.connectionId === connectionId).length;
        set((s) => ({
          dashboards: [
            ...s.dashboards,
            {
              id,
              connectionId,
              database,
              name: name ?? `Dashboard ${count + 1}`,
              datasets: [],
              widgets: [],
              refreshSec: 0,
              locked: false,
              createdAt: Date.now(),
            },
          ],
          active: { ...s.active, [connectionId]: id },
        }));
        return id;
      },
      update: (id, patch) =>
        set((s) => ({
          dashboards: s.dashboards.map((d) =>
            d.id === id ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) } : d,
          ),
        })),
      remove: (id) =>
        set((s) => {
          const gone = s.dashboards.find((d) => d.id === id);
          const dashboards = s.dashboards.filter((d) => d.id !== id);
          const active = { ...s.active };
          if (gone && active[gone.connectionId] === id) {
            const next = dashboards.find((d) => d.connectionId === gone.connectionId);
            if (next) active[gone.connectionId] = next.id;
            else delete active[gone.connectionId];
          }
          return { dashboards, active };
        }),
      duplicate: (id) => {
        const source = get().dashboards.find((d) => d.id === id);
        if (!source) return id;
        return get().importDashboard(
          { ...source, name: `${source.name} (Kopie)` },
          source.connectionId,
          source.database,
        );
      },
      setActive: (connectionId, id) =>
        set((s) => ({ active: { ...s.active, [connectionId]: id } })),
      importDashboard: (dashboard, connectionId, database) => {
        const existing = dashboard.filePath
          ? get().dashboards.find(
              (d) => d.filePath === dashboard.filePath && d.connectionId === connectionId,
            )
          : undefined;
        if (existing) {
          set((s) => ({
            dashboards: s.dashboards.map((d) =>
              d.id === existing.id ? { ...d, ...dashboard, id: d.id, connectionId, database } : d,
            ),
            active: { ...s.active, [connectionId]: existing.id },
          }));
          return existing.id;
        }
        const id = createId();
        set((s) => ({
          dashboards: [
            ...s.dashboards,
            {
              filePath: null,
              fileStamp: null,
              ...dashboard,
              id,
              connectionId,
              database,
              createdAt: Date.now(),
            } as Dashboard,
          ],
          active: { ...s.active, [connectionId]: id },
        }));
        return id;
      },
    }),
    { name: "l8db-dashboards", storage: createBufferedJsonStorage(() => window.localStorage) },
  ),
);
