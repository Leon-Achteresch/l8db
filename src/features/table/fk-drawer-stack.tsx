import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { TableView } from "@/features/table/table-view";
import { useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { useTableTabs } from "@/lib/table-tabs";
import { DrawerChrome } from "./fk-drawer-stack/drawer-chrome";
import { clampWidth, defaultWidth, FOCUSABLE } from "./fk-drawer-stack/drawer-width";

export function FkDrawerStack() {
  const stack = useFkDrawerStack((state) => state.stack);
  const widths = useFkDrawerStack((state) => state.widths);
  const pop = useFkDrawerStack((state) => state.pop);
  const popTo = useFkDrawerStack((state) => state.popTo);
  const clear = useFkDrawerStack((state) => state.clear);
  const setWidth = useFkDrawerStack((state) => state.setWidth);
  const openTab = useTableTabs((state) => state.openTab);
  const navigate = useNavigate();
  const [viewport, setViewport] = useState(() =>
    typeof window === "undefined" ? 1280 : window.innerWidth,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (stack.length === 0) {
      if (wasOpen.current) openerRef.current?.focus();
      openerRef.current = null;
      wasOpen.current = false;
      return;
    }
    if (!wasOpen.current && document.activeElement instanceof HTMLElement) {
      openerRef.current = document.activeElement;
    }
    wasOpen.current = true;
    const root = rootRef.current;
    const focusables = () => {
      if (!root) return [];
      return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => !el.hasAttribute("disabled") && el.tabIndex !== -1 && el.offsetParent !== null,
      );
    };
    const first = focusables()[0];
    if (first && root && !root.contains(document.activeElement)) first.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        useFkDrawerStack.getState().pop();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const items = focusables();
      if (items.length === 0) return;
      const start = items[0];
      const end = items[items.length - 1];
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [stack.length]);

  const openInTab = useCallback(
    (schema: string, table: string, filter?: string, filterRaw?: boolean) => {
      clear();
      openTab({ schema, table, entityType: "table" });
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema, table },
        search: filter ? { fkFilter: filter, ...(filterRaw ? { fkRaw: true } : {}) } : {},
      });
    },
    [clear, openTab, navigate],
  );

  if (stack.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50"
      role="dialog"
      aria-modal="true"
      aria-label="Verknüpfte Datensätze"
      tabIndex={-1}
    >
      <div
        aria-hidden
        onClick={() => pop()}
        className="absolute inset-0 bg-black/25 supports-backdrop-filter:backdrop-blur-[1px]"
      />
      <div className="pointer-events-none absolute inset-0" style={{ perspective: "1800px" }}>
        <div className="pointer-events-none absolute inset-0">
          {stack.map((entry, index) => {
            const depth = stack.length - 1 - index;
            const width = widths[entry.id] ?? defaultWidth(viewport);
            return (
              <DrawerChrome
                key={entry.id}
                id={entry.id}
                index={index}
                depth={depth}
                width={width}
                viewport={viewport}
                onWidthChange={(value) => setWidth(entry.id, clampWidth(value, viewport))}
                onFocus={() => popTo(entry.id)}
                onClose={() => (depth === 0 ? pop() : useFkDrawerStack.getState().popTo(entry.id))}
                onCloseAll={() => clear()}
                onOpenTab={() =>
                  openInTab(entry.schema, entry.table, entry.filter, entry.filterRaw)
                }
                title={`${entry.schema}.${entry.table}`}
                subtitle={entry.filter}
              >
                <TableView
                  schema={entry.schema}
                  table={entry.table}
                  fkFilter={entry.filter}
                  fkRaw={entry.filterRaw}
                  drawerId={entry.id}
                />
              </DrawerChrome>
            );
          })}
        </div>
      </div>
    </div>
  );
}
