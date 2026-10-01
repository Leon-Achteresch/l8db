import type { Column } from "@tanstack/react-table";
import { type RefObject, useRef } from "react";
import { flushSync } from "react-dom";
import type { TableRow } from "../data-table-types";
import { columnDragTarget } from "./column-drag-target";
import { INDEX_COLUMN } from "./constants";

const OFFSET = "--column-drag-x";
const SLIDE_MS = 200;
const SLIDE = `translate ${SLIDE_MS}ms cubic-bezier(0.25, 1, 0.5, 1)`;

type DragState = {
  ids: string[];
  widths: number[];
  groups: string[];
  from: number;
  to: number;
  startLeft: number;
  delta: number;
  onScroll: () => void;
};

type Options = {
  scope: string;
  scrollRef: RefObject<HTMLDivElement | null>;
  visibleColumns: Column<TableRow, unknown>[];
  columnWidths: number[];
  onMove: (fromIndex: number, toIndex: number) => void;
};

export function useColumnDragPreview({
  scope,
  scrollRef,
  visibleColumns,
  columnWidths,
  onMove,
}: Options) {
  const styleRef = useRef<HTMLStyleElement>(null);
  const drag = useRef<DragState | null>(null);
  const landing = useRef<ReturnType<typeof setTimeout> | null>(null);

  const root = `[data-column-scope="${scope}"]`;
  const headerCell = (id: string) => `${root} th[data-column-id="${CSS.escape(id)}"]`;
  const bodyCells = (id: string) => `${root} td[data-col="${CSS.escape(id)}"]`;
  const slideRule = `${root} th[data-column-id],${root} td[data-col]{transition:${SLIDE}}`;
  const draggedRule = (state: DragState, transition: string) => {
    const id = state.ids[state.from];
    const pinned = state.groups[state.from] !== "center";
    const lifted = `translate:var(${OFFSET}) 0;transition:${transition};box-shadow:-1px 0 0 0 var(--border),1px 0 0 0 var(--border)`;
    return `${headerCell(id)}{${lifted};z-index:${pinned ? 35 : 25}}${bodyCells(id)}{${lifted};z-index:${
      pinned ? 11 : 5
    };background-color:var(--background)}`;
  };

  const slotLeft = (state: DragState, scroller: HTMLElement, index: number) =>
    state.widths.slice(0, index).reduce((sum, width) => sum + width, 0) -
    (state.groups[state.from] === "center" ? scroller.scrollLeft : 0);

  const clear = () => {
    if (landing.current !== null) clearTimeout(landing.current);
    landing.current = null;
    if (styleRef.current) styleRef.current.textContent = "";
    scrollRef.current?.style.removeProperty(OFFSET);
  };

  const update = (delta?: number) => {
    const state = drag.current;
    const scroller = scrollRef.current;
    const style = styleRef.current;
    if (!state || !scroller || !style) return;
    const { ids, widths, groups, from } = state;
    if (delta !== undefined) state.delta = delta;
    const left = state.startLeft + state.delta;
    scroller.style.setProperty(OFFSET, `${left - slotLeft(state, scroller, from)}px`);
    const to = columnDragTarget(widths, groups, from, left + widths[from] / 2, scroller.scrollLeft);
    if (to === state.to && style.textContent !== "") return;
    state.to = to;
    const shifted = to > from ? ids.slice(from + 1, to + 1) : ids.slice(to, from);
    const shift = to > from ? -widths[from] : widths[from];
    style.textContent =
      slideRule +
      (shifted.length > 0
        ? `${shifted.flatMap((id) => [headerCell(id), bodyCells(id)]).join(",")}{translate:${shift}px 0}`
        : "") +
      draggedRule(state, "none");
  };

  const start = (id: string) => {
    const scroller = scrollRef.current;
    const from = visibleColumns.findIndex((column) => column.id === id);
    if (!scroller || from < 0) return;
    clear();
    const state: DragState = {
      ids: visibleColumns.map((column) => column.id),
      widths: columnWidths,
      groups: visibleColumns.map((column) =>
        column.id === INDEX_COLUMN ? "index" : column.getIsPinned() || "center",
      ),
      from,
      to: from,
      startLeft: 0,
      delta: 0,
      onScroll: () => {
        update();
        requestAnimationFrame(() => update());
      },
    };
    state.startLeft = slotLeft(state, scroller, from);
    drag.current = state;
    scroller.addEventListener("scroll", state.onScroll, { passive: true });
    update();
  };

  const end = (canceled: boolean) => {
    const state = drag.current;
    const scroller = scrollRef.current;
    const style = styleRef.current;
    drag.current = null;
    if (!state || !scroller || !style) return;
    scroller.removeEventListener("scroll", state.onScroll);
    const { from, to, widths } = state;
    const moved = !canceled && to !== from;
    if (moved) {
      const target = slotLeft(state, scroller, to) + (to > from ? widths[to] - widths[from] : 0);
      flushSync(() => onMove(from - 1, to - 1));
      style.textContent = draggedRule(state, "none");
      scroller.style.setProperty(OFFSET, `${state.startLeft + state.delta - target}px`);
      void scroller.offsetWidth;
    }
    style.textContent = (moved ? "" : slideRule) + draggedRule(state, SLIDE);
    scroller.style.setProperty(OFFSET, "0px");
    landing.current = setTimeout(clear, SLIDE_MS + 50);
  };

  return { styleRef, start, update, end };
}
