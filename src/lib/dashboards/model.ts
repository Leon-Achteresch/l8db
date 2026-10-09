export type Agg = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "none";
export type TimeBucket = "none" | "day" | "week" | "month" | "quarter" | "year";
export type DatasetMode = "simple" | "expert";
export type SortMode = "dimension" | "metric_desc" | "metric_asc";
export type Period = "all" | "7d" | "30d" | "90d" | "quarter" | "year" | "12m";
export type CompareMode = "none" | "previous" | "year";
export type HeadlineMode = "auto" | "total" | "last" | "average" | "max" | "min";
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
  | "pivot"
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
  compare: CompareMode;
  headline: HeadlineMode;
  invertDelta: boolean;
  unit: string;
  decimals: number | null;
  crossFilter: boolean;
  drill: boolean;
  totals: boolean;
  dataBars: boolean;
  target: number | null;
  targetLabel: string;
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
  compare: "previous",
  headline: "auto",
  invertDelta: false,
  unit: "",
  decimals: null,
  crossFilter: true,
  drill: true,
  totals: true,
  dataBars: false,
  target: null,
  targetLabel: "",
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
  "12m": "Letzte 12 Monate",
  quarter: "Dieses Quartal",
  year: "Dieses Jahr",
};

export const PALETTE = Array.from({ length: 8 }, (_, index) => `var(--dash-color-${index + 1})`);
export const ACCENT = "var(--dash-accent)";
export const COMPARE_COLOR = "var(--dash-compare)";
export const COMPARE_MARK = "var(--dash-compare-mark)";

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

export type JoinKind = "left" | "inner";

export interface JoinPair {
  from: string;
  to: string;
}

export interface DatasetJoin {
  id?: string;
  parent?: string | null;
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
  kind?: JoinKind;
  extra?: JoinPair[];
  manual?: boolean;
}

export interface CalculatedField {
  id: string;
  label: string;
  expr: string;
  aggregate: boolean;
  type?: "number" | "text" | "date";
}

export type VariableType = "text" | "number" | "date" | "select";

export interface DashboardVariable {
  id: string;
  name: string;
  label: string;
  type: VariableType;
  defaultValue: string;
  options?: string[];
  optionsSql?: string;
}

export const CROSS_WHERE = Symbol("crossWhere");

export interface CrossCondition {
  ref: string;
  bucket: TimeBucket;
  value: unknown;
}

export interface SimpleDataset {
  [CROSS_WHERE]?: CrossCondition[];
  schema: string;
  table: string;
  join: DatasetJoin | null;
  joins?: DatasetJoin[];
  calculated?: CalculatedField[];
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
  [CROSS_WHERE]?: CrossCondition[];
  id: string;
  name: string;
  mode: DatasetMode;
  simple: SimpleDataset;
  sql: string;
  mapping: ExpertMapping;
}

export type BlockKind = "text" | "image" | "link" | "divider";

export interface WidgetBlock {
  type: BlockKind;
  text?: string;
  src?: string;
  fit?: "contain" | "cover";
  href?: string;
  page?: string;
  align?: "left" | "center" | "right";
  variant?: "plain" | "card" | "accent";
}

export interface DashboardPage {
  id: string;
  name: string;
  hidden?: boolean;
}

export type ThemeFont = "system" | "inter" | "serif" | "mono" | "rounded" | "condensed";
export type ThemeCard = "outlined" | "elevated" | "flat" | "glass";
export type ThemeDensity = "compact" | "normal" | "spacious";

export interface DashboardTheme {
  brand?: string;
  tagline?: string;
  logo?: string;
  primary?: string;
  background?: string;
  surface?: string;
  text?: string;
  muted?: string;
  border?: string;
  palette?: string[];
  font?: ThemeFont;
  radius?: number;
  card?: ThemeCard;
  density?: ThemeDensity;
  header?: boolean;
  nav?: "tabs" | "sidebar";
}

export interface Widget {
  id: string;
  chart: ChartKind;
  datasetId: string | null;
  title: string;
  subtitle?: string;
  period: Period;
  options?: Partial<WidgetOptions>;
  page?: string | null;
  block?: WidgetBlock;
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
  variables?: DashboardVariable[];
  design?: { css: string; enabled: boolean };
  pages?: DashboardPage[];
  theme?: DashboardTheme | null;
  refreshSec: number;
  locked: boolean;
  createdAt: number;
  filePath?: string | null;
  fileStamp?: string | null;
  mcpId?: string | null;
  mcpStamp?: string | null;
  sharedId?: string | null;
}

export const GRID_COLS = 12;
export function minSize(kind: ChartKind): { minW: number; minH: number } {
  return kind === "kpi" || kind === "gauge" ? { minW: 2, minH: 3 } : { minW: 3, minH: 5 };
}

export const BLOCK_SIZE: Record<BlockKind, { w: number; h: number; minW: number; minH: number }> = {
  text: { w: 12, h: 2, minW: 2, minH: 1 },
  image: { w: 3, h: 3, minW: 1, minH: 1 },
  link: { w: 3, h: 1, minW: 1, minH: 1 },
  divider: { w: 12, h: 1, minW: 2, minH: 1 },
};

export function widgetMinSize(widget: Pick<Widget, "chart" | "block">): {
  minW: number;
  minH: number;
} {
  if (!widget.block) return minSize(widget.chart);
  const { minW, minH } = BLOCK_SIZE[widget.block.type] ?? BLOCK_SIZE.text;
  return { minW, minH };
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
