import { motion } from "motion/react";
import type { MouseEvent } from "react";

import { PlanWarningBadges } from "@/features/explain/plan-warning-badges";
import type { ExplainNode } from "@/lib/db";
import { SPRING_LAYOUT } from "@/lib/ease";
import {
  childId,
  formatMs,
  heatColor,
  type PlanAnalysis,
  ROOT_ID,
  selfShare,
} from "@/lib/explain-analysis";

interface ExplainNodeCardProps {
  node: ExplainNode;
  depth: number;
  id?: string;
  analysis?: PlanAnalysis;
  selectedId?: string | null;
  onSelect?: (id: string) => void;
}

export function ExplainNodeCard({
  node,
  depth,
  id = ROOT_ID,
  analysis,
  selectedId,
  onSelect,
}: ExplainNodeCardProps) {
  const children = node.Plans ?? [];
  const costShare =
    node["Actual Total Time"] != null && node["Actual Loops"]
      ? node["Actual Total Time"] * node["Actual Loops"]
      : null;
  const op = analysis?.byId.get(id);
  const selected = selectedId === id;
  const handleClick = (event: MouseEvent) => {
    if (!onSelect || selected) return;
    event.preventDefault();
    onSelect(id);
  };
  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className={depth === 0 ? "" : "ml-4 border-l border-border/60 pl-3"}
    >
      <details open={depth < 2} className="group py-1">
        <summary
          className={`cursor-pointer list-none rounded px-1 ${selected ? "bg-primary/10 ring-1 ring-primary/50" : ""}`}
          onClick={handleClick}
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
            {analysis && op && (
              <span
                className="size-2 shrink-0 rounded-full border border-border"
                style={{ background: heatColor(selfShare(analysis, op)) }}
              />
            )}
            <span className="rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              {node["Node Type"]}
            </span>
            {node["Relation Name"] && (
              <span className="font-mono font-medium">{node["Relation Name"]}</span>
            )}
            {node["Alias"] && node["Alias"] !== node["Relation Name"] && (
              <span className="text-muted-foreground">als {node["Alias"]}</span>
            )}
            {node["Index Name"] && (
              <span className="font-mono text-muted-foreground">auf {node["Index Name"]}</span>
            )}
            {Number.isFinite(node["Total Cost"]) && (
              <span className="text-muted-foreground">
                Kosten {Math.round(node["Startup Cost"] ?? 0)}…{Math.round(node["Total Cost"])}
                {node["Plan Rows"] != null && ` · ${node["Plan Rows"]} Zeilen`}
              </span>
            )}
            {costShare != null && (
              <span className="tabular-nums text-muted-foreground">
                · real {formatMs(costShare)}
                {node["Actual Rows"] != null && ` · ${node["Actual Rows"]} Zeilen`}
              </span>
            )}
            {node["Join Type"] && (
              <span className="text-muted-foreground">· {node["Join Type"]}</span>
            )}
            {op && <PlanWarningBadges warnings={op.warnings} />}
          </div>
          {(node["Index Cond"] || node["Filter"] || node["Hash Cond"]) && (
            <div className="mt-0.5 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {node["Index Cond"] && <p>Bedingung: {node["Index Cond"]}</p>}
              {node["Hash Cond"] && <p>Hash: {node["Hash Cond"]}</p>}
              {node["Filter"] && <p>Filter: {node["Filter"]}</p>}
            </div>
          )}
        </summary>
        {children.map((child, index) => (
          <ExplainNodeCard
            key={`${child["Node Type"]}-${child["Relation Name"] ?? ""}-${index}`}
            node={child}
            depth={depth + 1}
            id={childId(id, index)}
            analysis={analysis}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </details>
    </motion.div>
  );
}
