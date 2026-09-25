import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  formatCount,
  formatMetric,
  heatColor,
  METRIC_LABEL,
  type PlanAnalysis,
  type PlanOp,
  selfShare,
} from "@/lib/explain-analysis";
import { layoutFlame } from "@/lib/explain-flame";

const ROW_HEIGHT = 22;

interface PlanFlameViewProps {
  analysis: PlanAnalysis;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function describe(analysis: PlanAnalysis, op: PlanOp): string {
  const share = analysis.total > 0 ? Math.round((op.total / analysis.total) * 100) : 0;
  const parts = [
    `${op.label}${op.target ? ` · ${op.target}` : ""}`,
    `gesamt ${formatMetric(op.total, analysis.metric)} (${share} %)`,
    `selbst ${formatMetric(op.self, analysis.metric)}`,
  ];
  if (op.rows !== null) parts.push(`${formatCount(op.rows)} Zeilen`);
  if (op.warnings.length > 0) parts.push(`${op.warnings.length} Hinweis(e)`);
  return parts.join(" · ");
}

export function PlanFlameView({ analysis, selectedId, onSelect }: PlanFlameViewProps) {
  const [focus, setFocus] = useState<{ analysis: PlanAnalysis; id: string | null } | null>(null);
  const focusId = focus?.analysis === analysis ? focus.id : null;
  const setFocusId = (id: string | null) => setFocus({ analysis, id });
  const [hoverId, setHoverId] = useState<string | null>(null);
  const layout = useMemo(() => layoutFlame(analysis, focusId), [analysis, focusId]);
  const hovered = hoverId ? analysis.byId.get(hoverId) : undefined;
  const zoomed = layout.focusId !== analysis.root.id;

  const handleClick = (op: PlanOp) => {
    onSelect(op.id);
    setFocusId(op.id === layout.focusId ? op.parentId : op.id);
  };

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-h-6 items-center gap-2 text-[11px] text-muted-foreground">
        <span className="min-w-0 flex-1 truncate">
          {hovered
            ? describe(analysis, hovered)
            : `Breite = ${METRIC_LABEL[analysis.metric]} inkl. Kindknoten, Farbe = Eigenanteil. Klick zoomt hinein, erneuter Klick heraus.`}
        </span>
        {zoomed && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 shrink-0 px-2 text-[11px]"
            onClick={() => setFocusId(null)}
          >
            Zoom zurücksetzen
          </Button>
        )}
      </div>
      <div
        className="relative w-full overflow-hidden rounded border bg-background"
        style={{ height: layout.depth * ROW_HEIGHT }}
      >
        {layout.rects.map((rect) => {
          const op = analysis.byId.get(rect.id);
          if (!op) return null;
          const heat = heatColor(selfShare(analysis, op));
          return (
            <button
              key={rect.id}
              type="button"
              data-plan-node={rect.id}
              className={`absolute overflow-hidden border-r border-b border-background bg-muted px-1 text-left text-[10px] leading-[21px] whitespace-nowrap hover:brightness-95 ${rect.ancestor ? "opacity-60" : ""} ${selectedId === rect.id ? "z-10 outline-2 -outline-offset-2 outline-primary" : ""}`}
              style={{
                left: `${rect.x * 100}%`,
                width: `${rect.width * 100}%`,
                top: rect.depth * ROW_HEIGHT,
                height: ROW_HEIGHT,
                backgroundImage: `linear-gradient(${heat}, ${heat})`,
              }}
              title={describe(analysis, op)}
              onMouseEnter={() => setHoverId(rect.id)}
              onMouseLeave={() => setHoverId(null)}
              onClick={() => handleClick(op)}
            >
              {op.label}
              {op.target ? ` · ${op.target}` : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}
