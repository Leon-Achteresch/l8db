import { ancestorsOf, type PlanAnalysis } from "@/lib/explain-analysis";

export interface FlameRect {
  id: string;
  x: number;
  width: number;
  depth: number;
  ancestor: boolean;
}

export interface FlameLayout {
  rects: FlameRect[];
  depth: number;
  focusId: string;
}

export const MIN_FLAME_WIDTH = 0.002;

export function layoutFlame(analysis: PlanAnalysis, focusId?: string | null): FlameLayout {
  const focus = (focusId && analysis.byId.get(focusId)) || analysis.root;
  const ancestors = ancestorsOf(analysis, focus.id);
  const rects: FlameRect[] = ancestors.map((op, depth) => ({
    id: op.id,
    x: 0,
    width: 1,
    depth,
    ancestor: true,
  }));
  let maxDepth = ancestors.length;
  const place = (id: string, x: number, width: number, depth: number) => {
    const op = analysis.byId.get(id);
    if (!op || width < MIN_FLAME_WIDTH) return;
    rects.push({ id, x, width, depth, ancestor: false });
    maxDepth = Math.max(maxDepth, depth);
    let offset = x;
    for (const child of op.children) {
      const childOp = analysis.byId.get(child);
      if (!childOp) continue;
      const childWidth = op.total > 0 ? (width * childOp.total) / op.total : 0;
      place(child, offset, childWidth, depth + 1);
      offset += childWidth;
    }
  };
  place(focus.id, 0, 1, ancestors.length);
  return { rects, depth: maxDepth + 1, focusId: focus.id };
}
