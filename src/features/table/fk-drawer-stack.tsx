import { useNavigate } from "@tanstack/react-router";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { IconButton } from "@/components/icon-button";
import { TableView } from "@/features/table/table-view";
import { FK_DRAWER_DEFAULT_WIDTH, useFkDrawerStack } from "@/lib/fk-drawer-stack";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

const PEEK = 54;
const MIN_WIDTH = 480;
const MAX_WIDTH = 1320;
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function clampWidth(value: number, viewport: number) {
  const max = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, viewport - 64));
  return Math.min(max, Math.max(MIN_WIDTH, value));
}

function defaultWidth(viewport: number) {
  return clampWidth(Math.max(FK_DRAWER_DEFAULT_WIDTH, Math.round(viewport * 0.68)), viewport);
}

function DrawerChrome({
  id,
  index,
  depth,
  width,
  viewport,
  onWidthChange,
  onFocus,
  onClose,
  onCloseAll,
  onOpenTab,
  title,
  subtitle,
  children,
}: {
  id: string;
  index: number;
  depth: number;
  width: number;
  viewport: number;
  onWidthChange: (width: number) => void;
  onFocus: () => void;
  onClose: () => void;
  onCloseAll: () => void;
  onOpenTab: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const current = clampWidth(width, viewport);
  const offset = depth * PEEK;
  const scale = depth === 0 ? 1 : Math.max(0.94, 1 - depth * 0.02);
  const rotate = depth === 0 ? 0 : Math.min(14, depth * 5);
  const isBack = depth > 0;

  return (
    <section
      aria-label={title}
      data-fk-drawer={id}
      style={{
        width: current,
        zIndex: 20 + index,
        transform: isBack
          ? `translateX(${-offset}px) scale(${scale}) perspective(1600px) rotateY(${rotate}deg)`
          : "none",
        transformOrigin: "right center",
      }}
      className={cn(
        "pointer-events-auto absolute inset-y-0 right-0 flex min-h-0 flex-col overflow-hidden border-l bg-background shadow-2xl transition-transform duration-250 ease-smooth-out",
        isBack ? "rounded-l-xl brightness-[0.94]" : "rounded-l-none",
      )}
    >
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b bg-muted/40 px-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 font-mono text-[10px] font-bold text-primary">
            {index + 1}
          </span>
          <span className="truncate font-mono text-xs font-semibold">{title}</span>
          {subtitle && (
            <span className="hidden max-w-56 truncate rounded border px-1.5 py-px font-mono text-[10px] text-muted-foreground lg:inline">
              {subtitle}
            </span>
          )}
        </div>
        <IconButton
          aria-label={`${title} in Tab öffnen`}
          variant="ghost"
          size="icon-sm"
          onClick={onOpenTab}
        >
          <ExternalLinkIcon />
        </IconButton>
        {index > 0 && (
          <button
            type="button"
            onClick={onCloseAll}
            className="shrink-0 cursor-pointer rounded px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Alle
          </button>
        )}
        <IconButton
          aria-label={`${title} schließen`}
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
        >
          <XIcon />
        </IconButton>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden">{children}</div>
      {isBack && (
        <button
          type="button"
          aria-label={`${title} in den Vordergrund holen`}
          onClick={onFocus}
          className="absolute inset-0 cursor-pointer bg-transparent"
        />
      )}
      <div
        role="separator"
        tabIndex={0}
        aria-label={`Breite von ${title}`}
        aria-orientation="vertical"
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={Math.min(MAX_WIDTH, viewport - 64)}
        aria-valuenow={Math.round(current)}
        onPointerDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
          drag.current = { x: event.clientX, width: current };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current) onWidthChange(drag.current.width - (event.clientX - drag.current.x));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            onWidthChange(current + (event.key === "ArrowLeft" ? 24 : -24));
          }
        }}
        className="absolute inset-y-0 -left-2 z-10 flex w-4 touch-none cursor-col-resize items-center justify-center outline-none hover:bg-primary/10 focus-visible:bg-primary/15"
      >
        <span className="h-14 w-1 rounded-full bg-border" />
      </div>
    </section>
  );
}

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
