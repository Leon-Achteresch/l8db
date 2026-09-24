import type { PlanAnalysis } from "@/lib/explain-analysis";

export interface PlanGraphEdge {
  id: string;
  source: string;
  target: string;
  rows: number | null;
  width: number;
}

export const MIN_EDGE_WIDTH = 1;
export const MAX_EDGE_WIDTH = 10;

export function edgeWidth(rows: number | null, maxRows: number): number {
  if (rows === null || rows <= 0 || maxRows <= 0) return MIN_EDGE_WIDTH;
  const ratio = Math.log10(rows + 1) / Math.log10(maxRows + 1);
  return MIN_EDGE_WIDTH + (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH) * Math.min(1, ratio);
}

export function buildPlanEdges(analysis: PlanAnalysis): PlanGraphEdge[] {
  return analysis.ops.flatMap((op) =>
    op.parentId === null
      ? []
      : [
          {
            id: `${op.parentId}->${op.id}`,
            source: op.parentId,
            target: op.id,
            rows: op.rows,
            width: edgeWidth(op.rows, analysis.maxRows),
          },
        ],
  );
}
