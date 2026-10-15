import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { QueryResult } from "@/lib/db";
import type { ResultFilters, ResultSort } from "@/lib/result-grid";
import { readTabState, writeTabState } from "@/lib/tab-state";

interface ResultViewState {
  result: QueryResult | null;
  sorts: ResultSort[];
  filters: ResultFilters;
  filterRowOpen: boolean;
  autoColumnWidths: Record<string, number>;
}

interface SavedResultView extends ResultViewState {
  top: number;
  left: number;
}

export function useSavedResultView(key: string | undefined, result: QueryResult | null) {
  const [saved] = useState(() => {
    const view = key ? readTabState<SavedResultView>(key) : undefined;
    return view?.result === result ? view : undefined;
  });
  return saved;
}

export function useResultViewPersistence(
  key: string | undefined,
  scrollRef: RefObject<HTMLDivElement | null>,
  view: ResultViewState,
  saved: SavedResultView | undefined,
) {
  const entry = useRef<SavedResultView | null>(null);
  const { result, sorts, filters, filterRowOpen, autoColumnWidths } = view;
  useEffect(() => {
    if (!key) return;
    entry.current = {
      result,
      sorts,
      filters,
      filterRowOpen,
      autoColumnWidths,
      top: entry.current?.top ?? saved?.top ?? 0,
      left: entry.current?.left ?? saved?.left ?? 0,
    };
    writeTabState(key, entry.current);
  }, [key, result, sorts, filters, filterRowOpen, autoColumnWidths, saved]);
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!key || !element) return;
    let attempts = saved ? 20 : 0;
    let frame = 0;
    const restore = () => {
      if (!saved) return;
      element.scrollTop = saved.top;
      element.scrollLeft = saved.left;
      attempts -= 1;
      const done =
        Math.abs(element.scrollTop - saved.top) < 1 &&
        Math.abs(element.scrollLeft - saved.left) < 1;
      if (done || attempts <= 0) attempts = 0;
      else frame = requestAnimationFrame(restore);
    };
    const track = () => {
      if (attempts > 0 || !entry.current) return;
      entry.current.top = element.scrollTop;
      entry.current.left = element.scrollLeft;
    };
    restore();
    element.addEventListener("scroll", track, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      element.removeEventListener("scroll", track);
    };
  }, [key, scrollRef, saved]);
}
