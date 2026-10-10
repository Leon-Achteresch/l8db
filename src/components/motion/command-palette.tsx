"use client";

// beui.dev/components/blocks/command-palette

import { useHotkey } from "@tanstack/react-hotkeys";
import { defaultRangeExtractor, type Range, useVirtualizer } from "@tanstack/react-virtual";
import { Search } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion, useSpring } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NewBadge } from "@/components/new-badge";
import { paletteSearchItems, parsePaletteQuery, withHistory } from "@/lib/command-palette-search";
import { EASE_OUT } from "@/lib/ease";
import { createFreshElementScroll } from "@/lib/fresh-element-scroll";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useOnOpen } from "@/lib/hooks/use-on-open";
import { useRankedCommands } from "@/lib/hooks/use-ranked-commands";
import { useRowCursor } from "@/lib/hooks/use-row-cursor";
import { useTouchCapable } from "@/lib/hooks/use-touch-capable";
import { markNewFeatureSeen } from "@/lib/new-features";
import { observeVirtualScrollRect } from "@/lib/observe-virtual-scroll-rect";
import type { PaletteHistory } from "@/lib/palette-history";
import { useActivePortalContainer } from "@/lib/portal-container";
import { PresenceGate } from "@/lib/presence-gate";
import { cn } from "@/lib/utils";
import { measureVirtualItem } from "@/lib/virtual-item-measurement";
import { CommandPaletteOption } from "./command-palette/command-palette-option";
import { LIST_HEIGHT_SPRING, PANEL_SPRING } from "./command-palette/constants";
import type { CommandItem, CommandPaletteProps } from "./command-palette/types";

export type { CommandItem, CommandPaletteProps } from "./command-palette/types";

const NO_HISTORY: PaletteHistory = {};
type PaletteRow = { key: string; group?: string; item?: CommandItem; itemIndex: number };

export function CommandPalette({
  items,
  shortcut = "k",
  placeholder = "Type a command or search…",
  emptyMessage = "No results found.",
  open: controlledOpen,
  onOpenChange,
  maxVisible,
  lockDocumentScroll = true,
  featureId,
  queryItem,
  initialQuery = "",
  commandFeatureId,
  history = NO_HISTORY,
  onSelectItem,
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = controlledOpen !== undefined;
  const open = controlled ? controlledOpen : internalOpen;
  const setOpen = useCallback(
    (v: boolean) => {
      if (!controlled) setInternalOpen(v);
      onOpenChange?.(v);
    },
    [controlled, onOpenChange],
  );

  const [query, setQuery] = useState(initialQuery);
  // Portal target only exists client-side; render nothing during SSR/hydration.
  const [portalTarget, setPortalTarget] = useState<HTMLDivElement | null>(null);
  const portalHome = useRef<HTMLDivElement | null>(null);
  const returnContainerFocus = useRef<HTMLElement | null>(null);
  const activeContainer = useActivePortalContainer();
  const mounted = portalTarget !== null;
  useEffect(() => {
    const home = document.createElement("div");
    home.dataset.commandPaletteHome = "";
    home.className = "contents";
    const target = document.createElement("div");
    target.dataset.commandPalettePortal = "";
    target.style.position = "fixed";
    target.style.inset = "0";
    target.style.contain = "layout style";
    target.style.pointerEvents = "none";
    target.style.zIndex = "100";
    home.appendChild(target);
    document.body.appendChild(home);
    portalHome.current = home;
    setPortalTarget(target);
    return () => {
      target.remove();
      home.remove();
      portalHome.current = null;
    };
  }, []);
  const uid = useId();
  const reduce = useReducedMotion();
  const canTouch = useTouchCapable();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listFrameRef = useRef<HTMLDivElement>(null);
  const previousScroll = useRef<{ list: HTMLDivElement | null; active: number } | null>(null);
  const listHeight = useSpring(0, LIST_HEIGHT_SPRING);

  useLayoutEffect(() => {
    const home = portalHome.current;
    if (!portalTarget || !home) return;
    const parent = open && activeContainer?.isConnected ? activeContainer : home;
    if (portalTarget.parentElement === parent) return;
    const active = document.activeElement;
    if (parent !== home && active instanceof HTMLElement && !portalTarget.contains(active))
      returnContainerFocus.current = active;
    parent.appendChild(portalTarget);
    if (parent === home) {
      const target = returnContainerFocus.current;
      returnContainerFocus.current = null;
      if (!open && target?.isConnected) target.focus({ preventScroll: true });
    } else if (open) inputRef.current?.focus({ preventScroll: true });
  }, [activeContainer, open, portalTarget]);

  useHotkey(
    "Escape",
    (event) => {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
    },
    { enabled: open, ignoreInputs: false },
  );

  useHotkey(
    `Mod+${shortcut}` as never,
    () => {
      if (controlled) return;
      setOpen(!open);
    },
    { enabled: !controlled, ignoreInputs: false, preventDefault: true, stopPropagation: true },
  );

  useEffect(() => {
    if (!open || !lockDocumentScroll) return;
    const root = document.documentElement;
    if (root.scrollHeight <= root.clientHeight) return;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    root.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    return () => {
      root.style.overflow = previousRootOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [open, lockDocumentScroll]);

  const { commandsOnly, search } = parsePaletteQuery(query, Boolean(commandFeatureId));
  const searchItems = useMemo(
    () => withHistory(paletteSearchItems(items, commandsOnly), history, search),
    [items, commandsOnly, history, search],
  );
  const { query: rankedQuery, list: ranked } = useRankedCommands(searchItems, search, maxVisible);
  const searchFeature = useNewFeatureVisibility<HTMLDivElement>(featureId);
  const commandFeature = useNewFeatureVisibility<HTMLDivElement>(commandFeatureId);
  const filtered = useMemo(
    () =>
      queryItem && !commandsOnly && rankedQuery.trim()
        ? [...ranked, queryItem(rankedQuery.trim())]
        : paletteSearchItems(ranked, commandsOnly),
    [queryItem, commandsOnly, rankedQuery, ranked],
  );

  // Reserve the icon column only when at least one item brings an icon, so
  // icon-less lists don't render a dead gap before every label.
  const hasIcons = useMemo(() => items.some((it) => it.icon), [items]);

  const grouped = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    filtered.forEach((it) => {
      const g = it.group ?? "Results";
      const groupItems = map.get(g) ?? [];
      groupItems.push(it);
      map.set(g, groupItems);
    });
    return Array.from(map.entries());
  }, [filtered]);

  // Grouping reorders the list, so the rendered order is not the filtered
  // order whenever two groups interleave. Everything that has to agree on
  // "which row" — the highlight, the ids, Enter, the scroll — reads this one
  // array, so they cannot drift apart.
  const rows = useMemo(() => grouped.flatMap(([, list]) => list), [grouped]);

  const {
    activeIndex: active,
    moveTo,
    moveActive,
  } = useRowCursor(rows, `${commandsOnly}:${rankedQuery}`);
  const paletteRows = useMemo<PaletteRow[]>(() => {
    let itemIndex = 0;
    return grouped.flatMap(([group, list]) => [
      { key: `group:${group}`, group, itemIndex: -1 },
      ...list.map((item) => ({ key: `item:${item.id}`, item, itemIndex: itemIndex++ })),
    ]);
  }, [grouped]);
  const activeVirtualIndex = paletteRows.findIndex((row) => row.itemIndex === active);
  const rangeExtractor = useCallback(
    (range: Range) => {
      const indices = defaultRangeExtractor(range);
      if (activeVirtualIndex >= 0 && !indices.includes(activeVirtualIndex)) {
        indices.push(activeVirtualIndex);
        indices.sort((left, right) => left - right);
      }
      return indices;
    },
    [activeVirtualIndex],
  );
  const scrollToFn = useMemo(() => createFreshElementScroll<HTMLDivElement, HTMLDivElement>(), []);
  const listVirtualizer = useVirtualizer({
    count: paletteRows.length,
    enabled: open,
    getScrollElement: () => listRef.current,
    estimateSize: (index) => (paletteRows[index].item ? 36 : 27),
    getItemKey: (index) => paletteRows[index].key,
    initialRect: { width: 560, height: 480 },
    overscan: 2,
    rangeExtractor,
    measureElement: measureVirtualItem,
    observeElementRect: observeVirtualScrollRect,
    scrollToFn,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

  // Clearing the query would drop the cursor on its own, but only if it had
  // changed; `moveTo(null)` covers reopening on an already-empty query.
  useOnOpen(open, () => {
    setQuery(initialQuery);
    moveTo(null);
  });

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (open) setQuery(initialQuery);
  }, [initialQuery, open]);

  const selectItem = (item: CommandItem) => {
    if (rankedQuery !== search) return;
    if (item.featureId) markNewFeatureSeen(item.featureId);
    onSelectItem?.(item);
    setOpen(false);
    item.onSelect();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== inputRef.current || e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActive(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActive(-1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = rows[active];
      if (it) {
        selectItem(it);
      }
    }
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    const frame = listFrameRef.current;
    if (!mounted || !open || !list || !frame) return;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      const height = Math.round(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
      if (measured && !reduce) {
        listHeight.set(height);
        return;
      }
      measured = true;
      listHeight.jump(height);
      frame.style.height = `${height}px`;
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, [mounted, open, reduce, listHeight]);

  useEffect(() => {
    if (!open) {
      previousScroll.current = null;
      return;
    }
    const list = listRef.current;
    const previous = previousScroll.current;
    previousScroll.current = { list, active };
    if (active === 0) {
      if (list && previous && list === previous.list && previous.active !== 0) list.scrollTop = 0;
      return;
    }
    if (activeVirtualIndex >= 0)
      listVirtualizer.scrollToIndex(activeVirtualIndex, { align: "auto" });
  }, [active, open, activeVirtualIndex, listVirtualizer]);

  if (!portalTarget) return null;

  // Portaled to <body> so ancestors with transforms, filters, or fixed
  // positioning can't trap the overlay in their stacking context, and mounted
  // only while open. The chrome is two fixed siblings rather than one wrapper:
  // the backdrop spans the viewport edges but carries the scrim colour, and the
  // layer positioning the panel is inset off every edge. Both hang off
  // `PresenceGate`, so interaction releases in the same commit that starts the
  // exit rather than when it ends — `open` is already false for those frames.
  // See tests/fixed-overlay-edge-sampling.test.tsx.
  return createPortal(
    <AnimatePresence initial={false}>
      {open ? (
        <PresenceGate key="backdrop">
          {({ gate }) => (
            <motion.button
              type="button"
              aria-label="Close command palette"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{
                opacity: 0,
                transition: { duration: 0.12, ease: EASE_OUT },
              }}
              transition={{ duration: 0.18, ease: EASE_OUT }}
              {...gate}
              onClick={() => setOpen(false)}
              className="pointer-events-auto fixed inset-0 z-[100] bg-background/60"
            />
          )}
        </PresenceGate>
      ) : null}

      {open ? (
        <PresenceGate key="panel-layer">
          {({ isPresent, gate }) => (
            // The layer itself never takes pointer events, so it carries
            // `inert` alone rather than the gate's pointer-events value.
            <div
              inert={!isPresent}
              className="pointer-events-none fixed inset-x-4 bottom-4 top-[18vh] z-[100] flex items-start justify-center"
            >
              <motion.div
                role="dialog"
                aria-modal="true"
                aria-label="Command palette"
                initial={{
                  opacity: 0,
                  y: reduce ? 0 : -8,
                  scale: reduce ? 1 : 0.97,
                }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{
                  opacity: 0,
                  y: reduce ? 0 : -8,
                  scale: reduce ? 1 : 0.97,
                  transition: { duration: 0.12, ease: EASE_OUT },
                }}
                transition={reduce ? { duration: 0.1 } : PANEL_SPRING}
                {...gate}
                onKeyDown={onKeyDown}
                className="pointer-events-auto w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl will-change-transform"
              >
                <div
                  ref={
                    commandsOnly
                      ? commandFeature.ref
                      : rankedQuery.trim() && ranked.length > 0
                        ? searchFeature.ref
                        : undefined
                  }
                  className="flex items-center gap-3 border-b border-border px-4"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={commandsOnly ? "Befehl suchen…" : placeholder}
                    role="combobox"
                    // The field only exists while the palette is open.
                    aria-expanded="true"
                    aria-controls={`${uid}-list`}
                    aria-activedescendant={rows.length > 0 ? `${uid}-opt-${active}` : undefined}
                    aria-autocomplete="list"
                    className={cn(
                      "h-12 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none",
                      // The palette focuses this field the moment it opens, and iOS
                      // zooms the page in on a focused field under 16px: the fixed
                      // overlay is magnified off-center — clipped leading edge, half
                      // an icon column — and the zoom outlives the palette. 16px on
                      // touch keeps the page at scale 1; pointer devices keep 14px.
                      canTouch && "text-base",
                    )}
                  />
                  {(commandsOnly ? commandFeature.isNew : searchFeature.isNew) ? (
                    <NewBadge />
                  ) : null}
                  <kbd className="hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground sm:inline-block">
                    ESC
                  </kbd>
                </div>
                <motion.div
                  ref={listFrameRef}
                  style={{ height: listHeight }}
                  className="overflow-hidden"
                >
                  <div
                    ref={listRef}
                    id={`${uid}-list`}
                    role="listbox"
                    aria-label="Commands"
                    className="max-h-[60vh] overflow-y-auto overscroll-contain p-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                  >
                    {rows.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
                        {emptyMessage}
                      </div>
                    ) : (
                      <div className="relative" style={{ height: listVirtualizer.getTotalSize() }}>
                        {listVirtualizer.getVirtualItems().map((virtualRow) => {
                          const row = paletteRows[virtualRow.index];
                          const it = row.item;
                          return (
                            <div
                              key={virtualRow.key}
                              data-index={virtualRow.index}
                              ref={listVirtualizer.measureElement}
                              className="absolute top-0 left-0 w-full"
                              style={{ transform: `translateY(${virtualRow.start}px)` }}
                            >
                              {it ? (
                                <CommandPaletteOption
                                  item={it}
                                  query={rankedQuery}
                                  index={row.itemIndex}
                                  isActive={row.itemIndex === active}
                                  uid={uid}
                                  reduce={reduce}
                                  hasIcons={hasIcons}
                                  onHover={() => moveTo(it.id)}
                                  onSelect={() => selectItem(it)}
                                />
                              ) : (
                                <div
                                  aria-hidden
                                  className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                                >
                                  {row.group}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </motion.div>
                {commandFeatureId ? (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-2 text-[10px] text-muted-foreground">
                    <span>↑ ↓ Auswählen</span>
                    <span>↵ {commandsOnly ? "Ausführen" : "Öffnen"}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setQuery(commandsOnly ? search : `> ${query}`);
                        inputRef.current?.focus();
                      }}
                      className="ml-auto rounded px-1 py-0.5 hover:bg-accent hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      {commandsOnly ? "Alle durchsuchen" : "> Befehle"}
                      {!commandsOnly && commandFeature.isNew ? <NewBadge /> : null}
                    </button>
                  </div>
                ) : null}
              </motion.div>
            </div>
          )}
        </PresenceGate>
      ) : null}
    </AnimatePresence>,
    portalTarget,
  );
}
