import type { ReactNode } from "react";
import type { ChartKind } from "@/lib/dashboards";
import { AreaStacked } from "./area-stacked";
import { Bars } from "./bars";
import { Bubbles } from "./bubbles";
import type { ChartProps } from "./chart-utils";
import { Columns } from "./columns";
import { DataTable } from "./data-table";
import { Donut } from "./donut";
import { Flow } from "./flow";
import { Funnel } from "./funnel";
import { GaugeChart } from "./gauge-chart";
import { Heatmap } from "./heatmap";
import { Kpi } from "./kpi";
import { Lines } from "./lines";
import { RadarNet } from "./radar-net";
import { Rings } from "./rings";
import { Score } from "./score";
import { TreemapChart } from "./treemap-chart";

export const CHART_RENDERERS: Record<ChartKind, (props: ChartProps) => ReactNode> = {
  kpi: Kpi,
  area: AreaStacked,
  line: Lines,
  column: Columns,
  bars: Bars,
  funnel: Funnel,
  donut: Donut,
  rings: Rings,
  radar: RadarNet,
  scatter: Bubbles,
  sankey: Flow,
  score: Score,
  gauge: GaugeChart,
  treemap: TreemapChart,
  heatmap: Heatmap,
  table: DataTable,
};
