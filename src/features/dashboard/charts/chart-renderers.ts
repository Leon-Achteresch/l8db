import { type ComponentType, memo } from "react";
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
import "./chart-theme.css";

export const CHART_RENDERERS: Record<ChartKind, ComponentType<ChartProps>> = {
  kpi: memo(Kpi),
  area: memo(AreaStacked),
  line: memo(Lines),
  column: memo(Columns),
  bars: memo(Bars),
  funnel: memo(Funnel),
  donut: memo(Donut),
  rings: memo(Rings),
  radar: memo(RadarNet),
  scatter: memo(Bubbles),
  sankey: memo(Flow),
  score: memo(Score),
  gauge: memo(GaugeChart),
  treemap: memo(TreemapChart),
  heatmap: memo(Heatmap),
  table: memo(DataTable),
};
