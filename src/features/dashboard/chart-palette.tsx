import {
  ActivityIcon,
  AlignLeftIcon,
  ChartColumnIcon,
  ChartLineIcon,
  ChartPieIcon,
  CircleDotIcon,
  FilterIcon,
  GaugeIcon,
  Grid3x3Icon,
  HashIcon,
  LayoutGridIcon,
  type LucideIcon,
  RadarIcon,
  ScatterChartIcon,
  TableIcon,
  TargetIcon,
  WaypointsIcon,
} from "lucide-react";
import { CHARTS, type ChartKind, chartFits, type DatasetShape } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { setPendingDrag } from "./dashboard-canvas";

export const CHART_ICONS: Record<ChartKind, LucideIcon> = {
  kpi: HashIcon,
  area: ActivityIcon,
  line: ChartLineIcon,
  column: ChartColumnIcon,
  bars: AlignLeftIcon,
  funnel: FilterIcon,
  donut: ChartPieIcon,
  rings: CircleDotIcon,
  radar: RadarIcon,
  scatter: ScatterChartIcon,
  sankey: WaypointsIcon,
  score: GaugeIcon,
  gauge: TargetIcon,
  treemap: LayoutGridIcon,
  heatmap: Grid3x3Icon,
  table: TableIcon,
};

export function ChartPalette({
  shape,
  locked,
  onAdd,
}: {
  shape: DatasetShape | null;
  locked: boolean;
  onAdd: (kind: ChartKind) => void;
}) {
  return (
    <div className="p-3">
      <p className="mb-2 text-[11px] text-muted-foreground">
        {shape
          ? "Ziehe ein Chart auf die Fläche rechts oder klicke es an. Ausgegraute Charts passen nicht zum gewählten Datensatz."
          : "Wähle zuerst links einen Datensatz aus."}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(Object.keys(CHARTS) as ChartKind[]).map((kind) => {
          const Icon = CHART_ICONS[kind];
          const problem = shape ? chartFits(kind, shape) : "Kein Datensatz";
          const disabled = locked || Boolean(problem);
          return (
            <button
              key={kind}
              type="button"
              draggable={!disabled}
              disabled={disabled}
              title={problem ?? CHARTS[kind].hint}
              onDragStart={(e) => setPendingDrag(e, kind)}
              onClick={() => onAdd(kind)}
              className={cn(
                "flex flex-col items-start gap-1 rounded-xl border bg-card p-2.5 text-left transition-colors hover:border-primary/45",
                disabled ? "cursor-not-allowed opacity-45" : "cursor-grab active:cursor-grabbing",
              )}
            >
              <Icon className="size-4 text-lime-500" />
              <span className="text-xs font-medium">{CHARTS[kind].label}</span>
              <span className="line-clamp-2 text-[10px] leading-snug text-muted-foreground">
                {problem ?? CHARTS[kind].hint}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
