import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import { columnWindowRange } from "@/lib/column-window";
import { lastGridRect, rememberGridRect } from "@/lib/grid-rect";
import { IS_CHROMIUM } from "@/lib/platform";
import { useGridVirtualizer } from "./use-transition-virtualizer";

export type ColumnWindowItem = { index: number; span: number; width: number; spacer: boolean };

export function useColumnWindow(
  scrollRef: RefObject<HTMLDivElement | null>,
  widths: number[],
  pinned: number[],
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
    ? Math.ceil((IS_CHROMIUM ? 512 : 256) / Math.max(1, narrowest))
    : 2;
  const behind = Number.isFinite(narrowest) ? Math.ceil(64 / Math.max(1, narrowest)) : 1;
  const rangeExtractor = useCallback(
    (range: Parameters<typeof columnWindowRange>[0]) => {
      if (!IS_CHROMIUM) return columnWindowRange(range, pinned);
      const backward = direction.current === "backward";
      return columnWindowRange(
        range,
        pinned,
        backward ? overscan : behind,
        backward ? behind : overscan,
      );
    },
    [pinned, overscan, behind],
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
  const items = useMemo<ColumnWindowItem[]>(() => {
    const visible = enabled
      ? indices === ""
        ? pinned
        : indices.split(",").map(Number)
      : widths.map((_, index) => index);
    const result: ColumnWindowItem[] = [];
    let next = 0;
    for (const index of [...visible, widths.length]) {
      if (index > next) {
        let width = 0;
        for (let i = next; i < index; i++) width += widths[i];
        result.push({ index: next, span: index - next, width, spacer: true });
      }
      if (index < widths.length) {
        result.push({ index, span: 1, width: widths[index], spacer: false });
      }
      next = index + 1;
    }
    return result;
  }, [enabled, indices, widths, pinned]);
  return { items, virtualizer, enabled };
}
