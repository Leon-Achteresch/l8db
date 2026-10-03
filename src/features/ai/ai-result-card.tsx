import { ChartColumn, Table2 } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { aiChartConfig, parseAiTable } from "@/lib/ai/result";
import type { AiRichBlock } from "@/lib/ai/rich";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { buildChartData } from "@/lib/result-chart";
import { cn } from "@/lib/utils";
import { AiResultActions } from "./ai-result-actions";
import { AiResultTable } from "./ai-result-table";

const ResultChartCanvas = lazy(() =>
  import("@/features/query/result-chart/result-chart-canvas").then((module) => ({
    default: module.ResultChartCanvas,
  })),
);

type ToolBlock = Extract<AiRichBlock, { type: "tool" }>;

export function AiResultCard({ block }: { block: ToolBlock }) {
  const table = useMemo(() => parseAiTable(block.output), [block.output]);
  const config = useMemo(
    () => (table ? aiChartConfig(block.chart ?? {}, table) : null),
    [block.chart, table],
  );
  const data = useMemo(
    () => (table && config ? buildChartData(table.rows, config) : null),
    [table, config],
  );
  const chartable = Boolean(config && config.chart !== "table" && table?.rows.length);
  const [view, setView] = useState<"chart" | "table">("chart");
  const feature = useNewFeatureVisibility<HTMLElement>("ai.chat.charts");
  if (!table || !config || !data) return null;
  const title = block.title || "Ergebnis";
  const showChart = chartable && view === "chart";
  return (
    <figure ref={feature.ref} className="my-2 overflow-hidden rounded-xl border bg-card">
      <figcaption className="flex min-h-9 items-center gap-1 border-b py-1 pr-1 pl-3">
        <span className="mr-auto flex min-w-0 items-center gap-1.5 text-xs font-medium">
          <span className="truncate">{title}</span>
          {feature.isNew && <NewBadge />}
        </span>
        {chartable && (
          <fieldset className="mr-1 flex rounded-md bg-muted p-0.5" aria-label="Ansicht">
            {(
              [
                ["chart", ChartColumn, "Diagramm"],
                ["table", Table2, "Tabelle"],
              ] as const
            ).map(([id, Icon, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                aria-label={label}
                title={label}
                onClick={() => setView(id)}
                className={cn(
                  "grid size-6 place-items-center rounded text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  view === id && "bg-background text-foreground shadow-xs",
                )}
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </fieldset>
        )}
        <AiResultActions table={table} sql={block.sql} title={title} />
      </figcaption>
      {showChart ? (
        <div className={config.chart === "kpi" ? "h-36" : "h-72"}>
          <Suspense fallback={null}>
            <ResultChartCanvas chart={config.chart} data={data} />
          </Suspense>
        </div>
      ) : (
        <AiResultTable table={table} />
      )}
      <p className="border-t px-3 py-1 text-[11px] text-muted-foreground">{table.footer}</p>
    </figure>
  );
}
