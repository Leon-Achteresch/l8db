import { XIcon } from "lucide-react";
import { motion } from "motion/react";
import { SPRING_LAYOUT } from "@/lib/ease";

import { Button } from "@/components/ui/button";
import type { ExplainNode } from "@/lib/db";

interface ExplainPlanViewProps {
  plan: ExplainNode;
  analyzed: boolean;
  onClose: () => void;
}

function formatMs(value: number): string {
  return value < 10 ? `${value.toFixed(2)} ms` : `${Math.round(value)} ms`;
}

function NodeCard({ node, depth }: { node: ExplainNode; depth: number }) {
  const children = node.Plans ?? [];
  const costShare =
    node["Actual Total Time"] != null && node["Actual Loops"]
      ? node["Actual Total Time"] * node["Actual Loops"]
      : null;
  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className={depth === 0 ? "" : "ml-4 border-l border-border/60 pl-3"}
    >
      <details open={depth < 2} className="group py-1">
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
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
            <span className="text-muted-foreground">
              Kosten {Math.round(node["Startup Cost"])}…{Math.round(node["Total Cost"])} ·{" "}
              {node["Plan Rows"]} Zeilen
            </span>
            {costShare != null && (
              <span className="tabular-nums text-muted-foreground">
                · real {formatMs(costShare)}
                {node["Actual Rows"] != null && ` · ${node["Actual Rows"]} Zeilen`}
              </span>
            )}
            {node["Join Type"] && (
              <span className="text-muted-foreground">· {node["Join Type"]}</span>
            )}
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
          <NodeCard
            key={`${child["Node Type"]}-${child["Relation Name"] ?? ""}-${index}`}
            node={child}
            depth={depth + 1}
          />
        ))}
      </details>
    </motion.div>
  );
}

export function ExplainPlanView({ plan, analyzed, onClose }: ExplainPlanViewProps) {
  return (
    <div className="flex min-h-0 w-full flex-col border-b bg-muted/20">
      <div className="flex shrink-0 items-center gap-2 px-3 py-1.5">
        <span className="text-xs font-medium">
          Ausführungsplan{analyzed ? " (ANALYZE – Query wurde ausgeführt)" : ""}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="ml-auto size-7"
          onClick={onClose}
          title="Plan schließen"
        >
          <XIcon className="size-4" />
        </Button>
      </div>
      <div className="max-h-64 min-h-0 overflow-y-auto px-3 pb-2">
        <NodeCard node={plan} depth={0} />
      </div>
    </div>
  );
}
