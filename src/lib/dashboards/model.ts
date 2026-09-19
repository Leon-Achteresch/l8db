export type Agg = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "none";
export type TimeBucket = "none" | "day" | "week" | "month" | "quarter" | "year";
export type DatasetMode = "simple" | "expert";
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
  horizontal: boolean;
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
  horizontal: false,
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
  rangeId?: string;
  id: string;
  column: string;
  operator: string;
  value: string;
  dataType?: string;
}

export interface DatasetJoin {
  id?: string;
  parent?: string | null;
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
}

export interface SimpleDataset {
  schema: string;
  table: string;
  join: DatasetJoin | null;
  joins?: DatasetJoin[];
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
