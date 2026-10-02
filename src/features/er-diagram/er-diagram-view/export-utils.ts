export async function getFlowElement(): Promise<HTMLElement> {
  const el = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!el) throw new Error("React Flow viewport not found");
  return el;
}

export function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1];
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

import type { Edge, Rect } from "@xyflow/react";
import type { ErPoint } from "@/features/er-diagram/er-diagram-view/route-relationship";

export function getDiagramBounds(nodeBounds: Rect, edges: Edge[]): Rect {
  let left = nodeBounds.x;
  let top = nodeBounds.y;
  let right = left + nodeBounds.width;
  let bottom = top + nodeBounds.height;
  for (const edge of edges) {
    for (const point of (edge.data?.points as ErPoint[] | undefined) ?? []) {
      left = Math.min(left, point.x);
      top = Math.min(top, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}
