import type { Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, startTransition, useEffect, useRef, useState } from "react";
import { lastGridRect, rememberGridRect } from "@/lib/grid-rect";
import { useTableScrollState } from "@/lib/hooks/use-table-scroll-state";
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
    ((uiDensity === "compact" ? 25 : uiDensity === "spacious" ? 41 : 33) * uiScale) / 100;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    scrollMargin: draftHeight,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimatedRowHeight,
    overscan: Math.ceil(256 / estimatedRowHeight),
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    initialRect: { ...lastGridRect },
    onChange: rememberGridRect,
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
