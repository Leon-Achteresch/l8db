import type { Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type RefObject, useEffect } from "react";
import { useTableScrollState } from "@/lib/hooks/use-table-scroll-state";
import { useSettingsStore } from "@/lib/settings";
import type { TableRow } from "../data-table-types";

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
  });
  useEffect(() => {
    if (estimatedRowHeight > 0) rowVirtualizer.measure();
  }, [rowVirtualizer, estimatedRowHeight]);
  useTableScrollState(scrollRef, stateKey, scrollIdentity);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = Math.max(0, (virtualRows[0]?.start ?? 0) - draftHeight);
  const paddingBottom = Math.max(
    0,
    rowVirtualizer.getTotalSize() - ((virtualRows.at(-1)?.end ?? draftHeight) - draftHeight),
  );
  return { uiScale, rowVirtualizer, virtualRows, paddingTop, paddingBottom };
}
