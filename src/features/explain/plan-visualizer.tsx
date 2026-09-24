import { lazy, Suspense, useMemo, useState } from "react";

import { PlanFlameView } from "@/features/explain/plan-flame-view";
import { PlanNodeDetails } from "@/features/explain/plan-node-details";
import { PlanViewSwitcher } from "@/features/explain/plan-view-switcher";
import { ExplainNodeCard } from "@/features/query/explain-node-card";
import type { ExplainNode } from "@/lib/db";
import { analyzePlan, METRIC_LABEL } from "@/lib/explain-analysis";
import { useExplainViewPrefs } from "@/lib/explain-view-prefs";

const PlanGraphView = lazy(() =>
  import("@/features/explain/plan-graph-view").then((module) => ({
    default: module.PlanGraphView,
  })),
);

interface PlanVisualizerProps {
  plan: ExplainNode;
}

export function PlanVisualizer({ plan }: PlanVisualizerProps) {
  const view = useExplainViewPrefs((state) => state.view);
  const analysis = useMemo(() => analyzePlan(plan), [plan]);
  const [selection, setSelection] = useState<{ plan: ExplainNode; id: string } | null>(null);
  const selectedId = selection?.plan === plan ? selection.id : null;
  const selected = selectedId ? analysis.byId.get(selectedId) : undefined;
  const select = (id: string) => setSelection({ plan, id });
  const warnings = analysis.ops.reduce((sum, op) => sum + op.warnings.length, 0);

  return (
    <div className="flex min-h-0 min-w-0 flex-col gap-2" data-plan-view={view}>
      <div className="flex flex-wrap items-center gap-2">
        <PlanViewSwitcher />
        <span className="text-[11px] text-muted-foreground">
          {analysis.ops.length} Knoten · Gewichtung {METRIC_LABEL[analysis.metric]}
          {warnings > 0 && ` · ${warnings} Hinweis${warnings === 1 ? "" : "e"}`}
        </span>
      </div>
      {view === "graph" ? (
        <div className="h-80 min-w-0 rounded-md border bg-background">
          <Suspense fallback={null}>
            <PlanGraphView analysis={analysis} selectedId={selectedId} onSelect={select} />
          </Suspense>
        </div>
      ) : view === "flame" ? (
        <div className="max-h-80 min-w-0 overflow-y-auto">
          <PlanFlameView analysis={analysis} selectedId={selectedId} onSelect={select} />
        </div>
      ) : (
        <div className="max-h-80 min-w-0 overflow-y-auto">
          <ExplainNodeCard
            node={plan}
            depth={0}
            analysis={analysis}
            selectedId={selectedId}
            onSelect={select}
          />
        </div>
      )}
      {selected && (
        <PlanNodeDetails analysis={analysis} op={selected} onClose={() => setSelection(null)} />
      )}
    </div>
  );
}
