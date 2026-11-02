import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import { assignColumnSlots, columnWindowRange } from "@/lib/column-window";
import { lastGridRect, rememberGridRect } from "@/lib/grid-rect";
import { createGridWindowRange } from "@/lib/grid-window-range";
import { IS_CHROMIUM } from "@/lib/platform";
import { useGridVirtualizer } from "./use-transition-virtualizer";

export type ColumnWindowItem = { index: number; width: number; key: string };

export function useColumnWindow(
  scrollRef: RefObject<HTMLDivElement | null>,
  widths: number[],
  pinned: number[],
  overscanPixels = 256,
) {
  const enabled = widths.length > 20;
  const direction = useRef<"forward" | "backward" | null>(null);
  const narrowest = useMemo(() => {
    const pinnedSet = new Set(pinned);
    return widths.reduce(
      (min, width, index) => (pinnedSet.has(index) ? min : Math.min(min, width)),
      Number.POSITIVE_INFINITY,
    );
  }, [widths, pinned]);
  const overscan = Number.isFinite(narrowest)
    ? Math.ceil(overscanPixels / Math.max(1, narrowest))
    : 2;
  const behind = Number.isFinite(narrowest) ? Math.ceil(64 / Math.max(1, narrowest)) : 1;
  const windowRanges = useMemo(
    () => ({
      forward: createGridWindowRange(behind, overscan, 2, pinned),
      backward: createGridWindowRange(overscan, behind, 2, pinned),
    }),
    [behind, overscan, pinned],
  );
  const rangeExtractor = useCallback(
    (range: Parameters<typeof columnWindowRange>[0]) => {
      if (!IS_CHROMIUM) return columnWindowRange(range, pinned);
      return windowRanges[direction.current === "backward" ? "backward" : "forward"](range);
    },
    [pinned, windowRanges],
  );
  const virtualizer = useGridVirtualizer({
    horizontal: true,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    count: widths.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => widths[index],
    overscan: IS_CHROMIUM ? 0 : overscan,
    rangeExtractor,
    enabled,
    scrollPaddingStart: pinned.reduce((sum, index) => sum + widths[index], 0),
    initialRect: { ...lastGridRect },
    onChange: IS_CHROMIUM
      ? (instance) => {
          direction.current = instance.scrollDirection;
          rememberGridRect(instance);
        }
      : rememberGridRect,
  });
  const measuredWidths = useRef(widths);
  useEffect(() => {
    if (measuredWidths.current === widths) return;
    measuredWidths.current = widths;
    virtualizer.measure();
  }, [virtualizer, widths]);
  const indices = enabled
    ? virtualizer
        .getVirtualItems()
        .map((column) => column.index)
        .join(",")
    : "";
  const slots = useRef<ReadonlyMap<number, number>>(new Map());
  const items = useMemo<ColumnWindowItem[]>(() => {
    if (!enabled) return widths.map((width, index) => ({ index, width, key: String(index) }));
    const visible = indices === "" ? pinned : indices.split(",").map(Number);
    const assigned = assignColumnSlots(visible, slots.current);
    slots.current = assigned;
    return [...assigned]
      .sort((a, b) => a[1] - b[1])
      .map(([index, slot]) => ({ index, width: widths[index], key: `slot-${slot}` }));
  }, [enabled, indices, widths, pinned]);
  return { items, virtualizer, enabled };
}
