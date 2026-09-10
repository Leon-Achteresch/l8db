import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useEffect, useMemo } from "react";

import { columnWindowRange } from "@/lib/column-window";

export type ColumnWindowItem = { index: number; span: number; width: number; spacer: boolean };

export function useColumnWindow(
  scrollRef: RefObject<HTMLDivElement | null>,
  widths: number[],
  pinned: number[],
) {
  const enabled = widths.length > 20;
  const rangeExtractor = useCallback(
    (range: Parameters<typeof columnWindowRange>[0]) => columnWindowRange(range, pinned),
    [pinned],
  );
  const virtualizer = useVirtualizer({
    horizontal: true,
    useAnimationFrameWithResizeObserver: true,
    count: widths.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => widths[index],
    overscan: 2,
    rangeExtractor,
    enabled,
    scrollPaddingStart: pinned.reduce((sum, index) => sum + widths[index], 0),
  });
  useEffect(() => virtualizer.measure(), [virtualizer, widths]);
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
