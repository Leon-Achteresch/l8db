import type { Row } from "@tanstack/react-table";
import { defaultRangeExtractor, type Range } from "@tanstack/react-virtual";
import {
  type RefObject,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { lastGridRect, rememberGridRect } from "@/lib/grid-rect";
import { createGridWindowRange } from "@/lib/grid-window-range";
import { useTableScrollState } from "@/lib/hooks/use-table-scroll-state";
import { useGridVirtualizer } from "@/lib/hooks/use-transition-virtualizer";
import { IS_CHROMIUM } from "@/lib/platform";
import { useSettingsStore } from "@/lib/settings";
import { tableRowHeight } from "@/lib/table-style";
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
  const tableStyle = useSettingsStore((state) => state.tableStyle);
  const configuredRowHeight = tableRowHeight(tableStyle, uiDensity, uiScale);
  const [rowMeasurement, setRowMeasurement] = useState({
    input: configuredRowHeight,
    size: configuredRowHeight,
  });
  const estimatedRowHeight =
    rowMeasurement.input === configuredRowHeight ? rowMeasurement.size : configuredRowHeight;
  const direction = useRef<"forward" | "backward" | null>(null);
  const windowRanges = useMemo(() => {
    const behind = Math.ceil(64 / estimatedRowHeight);
    const ahead = Math.ceil(128 / estimatedRowHeight);
    return {
      forward: createGridWindowRange(behind, ahead, 4),
      backward: createGridWindowRange(ahead, behind, 4),
    };
  }, [estimatedRowHeight]);
  const rangeExtractor = useCallback(
    (range: Range) => {
      if (!IS_CHROMIUM) return defaultRangeExtractor(range);
      return windowRanges[direction.current === "backward" ? "backward" : "forward"](range);
    },
    [windowRanges],
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
  const measurementInput = useRef(configuredRowHeight);
  const measurementSize = useRef(estimatedRowHeight);
  measurementInput.current = configuredRowHeight;
  measurementSize.current = estimatedRowHeight;
  const rowMeasurer = useMemo(() => {
    let observer: ResizeObserver | null = null;
    let representative: HTMLTableRowElement | null = null;
    let frame = 0;
    const normalRows = new Set<HTMLTableRowElement>();
    const pending = new Map<HTMLTableRowElement, ResizeObserverEntry>();
    const resize = (element: HTMLTableRowElement, size: number) =>
      rowVirtualizer.resizeItem(Number(element.dataset.index), size);
    const flush = () => {
      frame = 0;
      if (!representative) {
        representative = [...normalRows].find((element) => element.isConnected) ?? null;
        if (representative) observer?.observe(representative);
      }
      for (const [element, entry] of pending) {
        if (!element.isConnected) continue;
        const size = entry.borderBoxSize[0]?.blockSize ?? element.getBoundingClientRect().height;
        if (!Number.isFinite(size) || size <= 0) continue;
        if (element.hasAttribute("data-dynamic-height")) resize(element, size);
        else if (element === representative) {
          const input = measurementInput.current;
          startTransition(() =>
            setRowMeasurement((previous) =>
              previous.input === input && previous.size === size ? previous : { input, size },
            ),
          );
        }
      }
      pending.clear();
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(flush);
    };
    const unobserve = (element: HTMLTableRowElement) => {
      observer?.unobserve(element);
      normalRows.delete(element);
      pending.delete(element);
      if (representative === element) {
        representative = null;
        if (normalRows.size) schedule();
      }
      if (frame && pending.size === 0 && (representative || normalRows.size === 0)) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };
    return {
      measureElement: (element: HTMLTableRowElement | null, dynamicHeight: boolean) => {
        if (!element) return;
        observer ??= new ResizeObserver((entries) => {
          for (const entry of entries) pending.set(entry.target as HTMLTableRowElement, entry);
          schedule();
        });
        if (dynamicHeight) {
          resize(element, element.getBoundingClientRect().height);
          observer.observe(element);
        } else {
          resize(element, measurementSize.current);
          normalRows.add(element);
          if (!representative) {
            representative = element;
            observer.observe(element);
          }
        }
        return () => unobserve(element);
      },
      disconnect: () => {
        observer?.disconnect();
        observer = null;
        representative = null;
        normalRows.clear();
        pending.clear();
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
      },
    };
  }, [rowVirtualizer]);
  useEffect(() => () => rowMeasurer.disconnect(), [rowMeasurer]);
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
  return {
    uiScale,
    rowVirtualizer,
    measureRow: rowMeasurer.measureElement,
    virtualRows,
    paddingTop,
    paddingBottom,
  };
}
