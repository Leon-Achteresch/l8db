import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Check, Search, Settings, Unplug, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ConnectionStatusIndicator } from "@/components/connection-status-indicator";
import { ProviderLogo } from "@/components/provider-logo";
import { Spinner } from "@/components/ui/spinner";
import { disconnectActiveConnection } from "@/features/connections/disconnect-button";
import { groupByServer, sortServerGroups } from "@/lib/connection-groups";
import { connectionSummary, providerFor } from "@/lib/connection-url";
import {
  type SavedConnection,
  sortConnectionsByName,
  useConnectionsStore,
} from "@/lib/connections";
import { compileSearchPatterns, splitSearchPatterns } from "@/lib/regex-search";
import { useRegexEnabled } from "@/lib/regex-search-prefs";
import { cn } from "@/lib/utils";
import { SidebarConnectionTriggerContent } from "./sidebar-connection-trigger";

interface Props {
  activeConnection: SavedConnection | null;
  busyId: string | null;
  isSwitching: boolean;
  switchTarget: SavedConnection | undefined;
  onSelect: (id: string) => void;
}

export function SidebarConnectionPicker({
  activeConnection,
  busyId,
  isSwitching,
  switchTarget,
  onSelect,
}: Props) {
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const connections = useConnectionsStore((state) => state.connections);
  const favoriteServerKeys = useConnectionsStore((state) => state.favoriteServerKeys);
  const serverOrder = useConnectionsStore((state) => state.serverOrder);
  const hostGroupRules = useConnectionsStore((state) => state.hostGroupRules);
  const regexEnabled = useRegexEnabled("sidebar");
  const [open, setOpen] = useState(false);
  const [panelHeight, setPanelHeight] = useState(40);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }, []);

  const closeAndFocus = useCallback(() => {
    close();
    requestAnimationFrame(() => triggerRef.current?.focus());
  }, [close]);

  const groups = useMemo(
    () =>
      sortServerGroups(
        groupByServer(sortConnectionsByName(connections), hostGroupRules),
        favoriteServerKeys,
        serverOrder,
      ),
    [connections, favoriteServerKeys, hostGroupRules, serverOrder],
  );

  const rows = useMemo(
    () =>
      groups.flatMap((group) =>
        group.connections.map((connection) => {
          const endpoint = connectionSummary(connection.connectionString, connection.kind);
          const address = endpoint.port ? `${endpoint.host}:${endpoint.port}` : endpoint.host;
          return {
            connection,
            groupLabel: group.label,
            favorite: Boolean(connection.favorite || favoriteServerKeys.includes(group.key)),
            detail: [endpoint.database, address].filter(Boolean).join(" · "),
            searchText: [
              group.label,
              connection.name,
              connection.kind,
              endpoint.host,
              endpoint.port,
              endpoint.database,
              endpoint.user,
              ...(connection.tags?.map((tag) => tag.name) ?? []),
            ].join("\0"),
          };
        }),
      ),
    [favoriteServerKeys, groups],
  );

  const visible = useMemo(() => {
    const trimmed = query.trim();
    const patterns = splitSearchPatterns(trimmed).map((pattern) => pattern.toLowerCase());
    const compiled =
      regexEnabled && trimmed ? compileSearchPatterns(trimmed, { global: false }) : null;
    return rows
      .filter((row) => {
        if (!trimmed) return true;
        const lower = row.searchText.toLowerCase();
        return (
          patterns.some((pattern) => lower.includes(pattern)) ||
          (compiled?.ok === true && compiled.regexes.some((regex) => regex.test(row.searchText)))
        );
      })
      .sort((a, b) => {
        const priority = (row: (typeof rows)[number]) =>
          row.connection.id === activeConnection?.id ? 0 : row.favorite ? 1 : 2;
        return priority(a) - priority(b);
      });
  }, [activeConnection?.id, query, regexEnabled, rows]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const panel = panelRef.current;
    const measure = () => setPanelHeight(panel.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [close, open]);

  useEffect(() => {
    if (isSwitching) close();
  }, [close, isSwitching]);

  useEffect(() => {
    if (!open || !visible.length) return;
    listRef.current
      ?.querySelector<HTMLElement>(
        `[data-connection-index="${Math.min(highlighted, visible.length - 1)}"]`,
      )
      ?.scrollIntoView({ block: "nearest" });
  }, [highlighted, open, visible.length]);

  function select(id: string) {
    if (isSwitching) return;
    closeAndFocus();
    if (id !== activeConnection?.id) onSelect(id);
  }

  function onSearchKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocus();
      return;
    }
    if (event.altKey && /^[1-3]$/.test(event.key)) {
      const target = visible[Number(event.key) - 1];
      if (target) {
        event.preventDefault();
        select(target.connection.id);
      }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((current) =>
        visible.length
          ? (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length
          : 0,
      );
    }
    if (event.key === "Enter" && visible.length) {
      event.preventDefault();
      select(visible[Math.min(highlighted, visible.length - 1)].connection.id);
    }
  }

  return (
    <div ref={rootRef} className="relative h-10 w-full">
      <motion.div
        initial={false}
        animate={{ height: open ? panelHeight : 40 }}
        transition={{
          height: reduceMotion
            ? { duration: 0 }
            : open
              ? { type: "spring", stiffness: 300, damping: 28, mass: 0.82 }
              : { duration: 0.26, ease: [0.4, 0, 0.2, 1] },
        }}
        className="absolute inset-x-0 top-0 z-30 overflow-hidden rounded-xl border border-border bg-background text-foreground shadow-sm"
      >
        <AnimatePresence initial={false} mode="popLayout">
          {!open ? (
            <motion.button
              key="trigger"
              ref={triggerRef}
              type="button"
              data-tour="sidebar-connection"
              aria-expanded={false}
              onClick={() => setOpen(true)}
              className="flex h-10 w-full min-w-0 items-center gap-2 px-3 text-left text-xs hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <SidebarConnectionTriggerContent
                isSwitching={isSwitching}
                switchTarget={switchTarget}
                activeConnection={activeConnection}
              />
            </motion.button>
          ) : (
            <motion.div
              key="panel"
              ref={panelRef}
              initial={reduceMotion ? false : { opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={
                reduceMotion
                  ? undefined
                  : { opacity: 0, transition: { duration: 0.09, ease: "easeOut" } }
              }
              transition={{
                duration: reduceMotion ? 0 : 0.18,
                ease: "easeOut",
                delay: reduceMotion ? 0 : 0.04,
              }}
            >
              <div className="flex h-10 items-center gap-2 border-b border-border/70 px-3">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setHighlighted(0);
                  }}
                  onKeyDown={onSearchKeyDown}
                  role="combobox"
                  aria-expanded={true}
                  aria-controls={listId}
                  aria-activedescendant={
                    visible.length
                      ? `${listId}-${Math.min(highlighted, visible.length - 1)}`
                      : undefined
                  }
                  aria-label="Verbindungen suchen"
                  placeholder="Verbindung oder Host suchen…"
                  autoComplete="off"
                  spellCheck={false}
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  aria-label="Schnellwechsel schließen"
                  onClick={closeAndFocus}
                  className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3.5" />
                </button>
              </div>
              <div
                id={listId}
                ref={listRef}
                role="listbox"
                aria-label="Gespeicherte Verbindungen"
                className="max-h-[min(20rem,calc(100dvh-12.5rem))] min-h-12 overflow-y-auto overscroll-contain py-1"
              >
                {connections.length === 0 ? (
                  <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                    Keine Verbindungen gespeichert
                  </p>
                ) : visible.length === 0 ? (
                  <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                    Keine Treffer
                  </p>
                ) : (
                  visible.map((row, index) => {
                    const active = row.connection.id === activeConnection?.id;
                    const previous = visible[index - 1];
                    const group = active ? "Aktuell" : row.favorite ? "Favoriten" : "Weitere";
                    const previousGroup = previous
                      ? previous.connection.id === activeConnection?.id
                        ? "Aktuell"
                        : previous.favorite
                          ? "Favoriten"
                          : "Weitere"
                      : null;
                    return (
                      <div key={row.connection.id}>
                        {!query && group !== previousGroup && (
                          <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">
                            {group}
                          </div>
                        )}
                        <button
                          id={`${listId}-${index}`}
                          data-connection-index={index}
                          key={row.connection.id}
                          type="button"
                          role="option"
                          aria-selected={active}
                          disabled={isSwitching}
                          onMouseEnter={() => setHighlighted(index)}
                          onClick={() => select(row.connection.id)}
                          className={cn(
                            "flex h-11 w-full min-w-0 items-center gap-2 px-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50",
                            index === highlighted
                              ? "bg-primary/9"
                              : active
                                ? "bg-primary/[0.06]"
                                : "hover:bg-muted/60",
                          )}
                        >
                          <span className="relative grid size-7 shrink-0 place-items-center rounded-md bg-muted/60">
                            <ProviderLogo
                              providerId={providerFor(row.connection).id}
                              kind={row.connection.kind}
                              className="size-4"
                            />
                            <ConnectionStatusIndicator
                              connectionId={row.connection.id}
                              className="absolute -bottom-0.5 -right-0.5 rounded-full bg-background"
                            />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1">
                              <span className="truncate text-xs font-medium">
                                {row.connection.name}
                              </span>
                              {row.connection.tags?.[0] && (
                                <span
                                  className="max-w-16 shrink-0 truncate rounded px-1 font-mono text-[9px] text-white"
                                  style={{ backgroundColor: row.connection.tags[0].color }}
                                >
                                  {row.connection.tags[0].name}
                                </span>
                              )}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">
                              {row.detail || row.groupLabel}
                            </span>
                          </span>
                          {busyId === row.connection.id ? (
                            <Spinner className="size-3.5 shrink-0" />
                          ) : index < 3 ? (
                            <kbd className="shrink-0 rounded border px-1 font-mono text-[10px] text-muted-foreground">
                              {index + 1}
                            </kbd>
                          ) : active ? (
                            <Check className="size-3.5 shrink-0 text-primary" />
                          ) : null}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="border-t border-border/70 px-1 py-1">
                {activeConnection && (
                  <button
                    type="button"
                    disabled={isSwitching}
                    onClick={() => {
                      close();
                      void disconnectActiveConnection(queryClient);
                    }}
                    className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Unplug className="size-3.5 text-muted-foreground" /> Verbindung trennen
                  </button>
                )}
                <Link
                  to="/connections"
                  onClick={close}
                  className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Settings className="size-3.5 text-muted-foreground" /> Verbindungen verwalten
                </Link>
              </div>
              <div className="flex items-center justify-between border-t border-border/70 px-3 py-1.5 text-[10px] text-muted-foreground">
                <span>↑ ↓ · ↵ · ⌥1–3</span>
                <span>esc schließen</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}
