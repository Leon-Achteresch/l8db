import { ArrowUpRight, ChartLine, ChevronDown, Table2 } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { useAiFigures } from "@/lib/ai/figures";
import { aiChartConfig, aiRowsLabel, parseAiTable } from "@/lib/ai/result";
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

export function AiResultCard({ block, inShelf = false }: { block: ToolBlock; inShelf?: boolean }) {
  const figures = useAiFigures();
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
  const [sqlOpen, setSqlOpen] = useState(false);
  const feature = useNewFeatureVisibility<HTMLElement>(inShelf ? undefined : "ai.chat.charts");
  if (!table || !config || !data) return null;
  const title = block.title || "Ergebnis";
  const number = figures.numbers.get(block.id);
  const label = number ? (
    <span
      title={`Abbildung ${number}`}
      className="grid size-5 shrink-0 place-items-center rounded-md bg-primary/10 text-[11px] font-semibold tabular-nums text-primary"
    >
      {number}
    </span>
  ) : null;
  const showChart = chartable && view === "chart";
  if (figures.shelf && !inShelf)
    return (
      <button
        type="button"
        ref={feature.ref}
        onClick={() => figures.focus(block.id)}
        className="group/ref my-2 flex w-full items-center gap-3 rounded-2xl bg-muted/55 px-3.5 py-2.5 text-left outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        {label}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium" title={title}>
            {title}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {chartable ? "Diagramm" : "Tabelle"} · {aiRowsLabel(table.footer)}
          </span>
        </span>
        {feature.isNew && <NewBadge />}
        <ArrowUpRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover/ref:translate-x-0.5 group-hover/ref:-translate-y-0.5" />
      </button>
    );
  return (
    <figure
      ref={feature.ref}
      id={inShelf ? `ai-shelf-${block.id}` : undefined}
      data-focused={figures.focused === block.id || undefined}
      className={cn(
        "my-3 overflow-hidden rounded-2xl bg-card shadow-[0_1px_2px_oklch(0_0_0/5%),0_8px_24px_-12px_oklch(0_0_0/16%)] transition-shadow duration-500",
        "data-focused:shadow-[0_0_0_2px_color-mix(in_oklab,var(--primary)_40%,transparent),0_8px_24px_-12px_oklch(0_0_0/16%)]",
      )}
    >
      <figcaption className="flex min-h-11 items-center gap-2 py-1.5 pr-1.5 pl-3.5">
        {label}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] font-semibold">
          <span className="truncate" title={title}>
            {title}
          </span>
          {feature.isNew && <NewBadge />}
        </span>
        {chartable && (
          <fieldset className="flex shrink-0 rounded-full bg-muted p-0.5" aria-label="Ansicht">
            {(
              [
                ["chart", "Diagramm", ChartLine],
                ["table", "Tabelle", Table2],
              ] as const
            ).map(([id, text, Icon]) => (
              <button
                key={id}
                type="button"
                aria-pressed={view === id}
                aria-label={text}
                title={text}
                onClick={() => setView(id)}
                className={cn(
                  "grid h-6 w-7 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
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
        <div
          className={config.chart === "kpi" ? "h-32" : inShelf ? "h-64" : "h-48"}
          style={
            config.chart === "bars"
              ? { height: Math.min(data.rows.length, 10) * 28 + 24 }
              : undefined
          }
        >
          <Suspense fallback={null}>
            <ResultChartCanvas
              chart={config.chart}
              data={data}
              legend={config.chart === "donut" || Boolean(config.series)}
              className="px-3 pt-1 pb-2"
            />
          </Suspense>
        </div>
      ) : (
        <AiResultTable table={table} />
      )}
      <div className="flex min-h-8 items-center gap-2 px-3.5 pb-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate tabular-nums">{aiRowsLabel(table.footer)}</span>
        {block.sql && (
          <button
            type="button"
            aria-expanded={sqlOpen}
            onClick={() => setSqlOpen(!sqlOpen)}
            className="-mr-1.5 flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            SQL
            <ChevronDown
              className={cn("size-3 transition-transform duration-200", sqlOpen && "rotate-180")}
            />
          </button>
        )}
      </div>
      {sqlOpen && block.sql && (
        <pre className="mx-2 mb-2 max-h-48 overflow-auto rounded-xl bg-muted/70 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/80">
          {block.sql}
        </pre>
      )}
    </figure>
  );
}
