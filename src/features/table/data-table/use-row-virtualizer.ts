import type { Row } from "@tanstack/react-table";
import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import { type RefObject, startTransition, useCallback, useEffect, useRef, useState } from "react";
import { lastGridRect, rememberGridRect } from "@/lib/grid-rect";
import { useTableScrollState } from "@/lib/hooks/use-table-scroll-state";
import { useGridVirtualizer } from "@/lib/hooks/use-transition-virtualizer";
import { IS_CHROMIUM } from "@/lib/platform";
import { useSettingsStore } from "@/lib/settings";
import type { TableRow } from "../data-table-types";

const FIRST_PAINT_ROWS = 8;

export function useRowVirtualizer(
  rows: Row<TableRow>[],
  draftHeight: number,
  scrollRef: RefObject<HTMLDivElement | null>,
  stateKey: string | undefined,
  scrollIdentity: string,
) {
  const uiScale = useSettingsStore((state) => state.uiScale);
  const uiDensity = useSettingsStore((state) => state.uiDensity);
  const estimatedRowHeight =
    ((uiDensity === "compact" ? 24 : uiDensity === "spacious" ? 40 : 32) * uiScale) / 100 + 1;
  const direction = useRef<"forward" | "backward" | null>(null);
  const rangeExtractor = useCallback(
    (range: Range) => {
      if (!IS_CHROMIUM) return defaultRangeExtractor(range);
      const backward = direction.current === "backward";
      const behind = Math.ceil(64 / estimatedRowHeight);
      const ahead = Math.ceil(256 / estimatedRowHeight);
      const first = Math.max(0, range.startIndex - (backward ? ahead : behind));
      const last = Math.min(range.count - 1, range.endIndex + (backward ? behind : ahead));
      return Array.from({ length: Math.max(0, last - first + 1) }, (_, index) => first + index);
    },
    [estimatedRowHeight],
  );
  const rowVirtualizer = useGridVirtualizer({
    count: rows.length,
    scrollMargin: draftHeight,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    measureElement: (element, entry) => {
      if (!element.hasAttribute("data-dynamic-height")) return estimatedRowHeight;
      const box = entry?.borderBoxSize[0];
      return box ? Math.round(box.blockSize) : (element as HTMLElement).offsetHeight;
    },
    overscan: IS_CHROMIUM ? 0 : Math.ceil(128 / estimatedRowHeight),
    rangeExtractor,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    initialRect: { ...lastGridRect },
    onChange: IS_CHROMIUM
      ? (instance) => {
          direction.current = instance.scrollDirection;
          rememberGridRect(instance);
        }
      : rememberGridRect,
  });
  const measuredRowHeight = useRef(estimatedRowHeight);
  useEffect(() => {
    if (measuredRowHeight.current === estimatedRowHeight) return;
    measuredRowHeight.current = estimatedRowHeight;
    if (estimatedRowHeight > 0) rowVirtualizer.measure();
  }, [rowVirtualizer, estimatedRowHeight]);
  useTableScrollState(scrollRef, stateKey, scrollIdentity);
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => startTransition(() => setWarm(true)));
    return () => cancelAnimationFrame(frame);
  }, []);
  const allRows = rowVirtualizer.getVirtualItems();
  const virtualRows = warm ? allRows : allRows.slice(0, FIRST_PAINT_ROWS);
  const paddingTop = Math.max(0, (virtualRows[0]?.start ?? 0) - draftHeight);
  const paddingBottom = Math.max(
    0,
    rowVirtualizer.getTotalSize() - ((virtualRows.at(-1)?.end ?? draftHeight) - draftHeight),
  );
  return { uiScale, rowVirtualizer, virtualRows, paddingTop, paddingBottom };
}
