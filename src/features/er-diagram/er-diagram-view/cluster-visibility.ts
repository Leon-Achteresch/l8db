import type { Viewport } from "@xyflow/react";
import {
  CLUSTER_DETAIL_ZOOM,
  CLUSTER_OVERSCAN,
} from "@/features/er-diagram/er-diagram-view/constants";

export function visibleClusterIds(
  frames: { id: string; position: { x: number; y: number }; width: number; height: number }[],
  viewport: Viewport,
  width: number,
  height: number,
): string[] {
  if (viewport.zoom < CLUSTER_DETAIL_ZOOM || width <= 0 || height <= 0) return [];
  return frames
    .filter((frame) => {
      const x = frame.position.x * viewport.zoom + viewport.x;
      const y = frame.position.y * viewport.zoom + viewport.y;
      return (
        x < width + CLUSTER_OVERSCAN &&
        y < height + CLUSTER_OVERSCAN &&
        x + frame.width * viewport.zoom > -CLUSTER_OVERSCAN &&
        y + frame.height * viewport.zoom > -CLUSTER_OVERSCAN
      );
    })
    .map((frame) => frame.id);
}
