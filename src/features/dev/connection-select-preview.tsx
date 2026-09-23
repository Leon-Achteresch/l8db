import {
  Check,
  ChevronDown,
  ChevronsUpDown,
  Command,
  Database,
  Search,
  Server,
  Star,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";

type Variant = "clear" | "server" | "command" | "cards";

interface DemoConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  host: string;
  database: string;
  environment: string;
  status: "online" | "offline" | "unknown";
}

const baseConnections: DemoConnection[] = [
  {
    id: "staging",
    name: "Shop · Staging",
    kind: "postgres",
    host: "db.shop.example",
    database: "shop_staging",
    environment: "STAGE",
    status: "online",
  },
  {
    id: "production",
    name: "Shop · Produktion",
    kind: "postgres",
    host: "db.shop.example",
    database: "shop_live",
    environment: "PROD",
    status: "online",
  },
  {
    id: "local",
    name: "Shop · Lokal",
    kind: "postgres",
    host: "localhost:5432",
    database: "shop_dev",
    environment: "DEV",
    status: "unknown",
  },
  {
    id: "warehouse",
    name: "Analytics Warehouse",
    kind: "mysql",
    host: "data.example",
    database: "warehouse",
    environment: "DATA",
    status: "offline",
  },
  {
    id: "archive",
    name: "Archiv 2025",
    kind: "sqlite",
    host: "Lokale Datei",
    database: "archive_2025.db",
    environment: "LOCAL",
    status: "unknown",
  },
];

const denseGroups: { name: string; host: string; kind: DatabaseKind }[] = [
  { name: "Billing", host: "db.billing.example", kind: "postgres" },
  { name: "Accounts", host: "db.accounts.example", kind: "postgres" },
  { name: "Inventory", host: "db.inventory.example", kind: "mysql" },
  { name: "CRM", host: "db.crm.example", kind: "postgres" },
  { name: "Events", host: "db.events.example", kind: "mysql" },
  { name: "Reports", host: "db.reports.example", kind: "postgres" },
  { name: "Audit", host: "db.audit.example", kind: "postgres" },
  { name: "Support", host: "db.support.example", kind: "mysql" },
  { name: "Catalog", host: "db.catalog.example", kind: "postgres" },
  { name: "Sandbox", host: "db.sandbox.example", kind: "postgres" },
];

const denseConnections: DemoConnection[] = denseGroups.flatMap((group, groupIndex) =>
  (
    [
      ["Entwicklung", "DEV"],
      ["Staging", "STAGE"],
      ["Produktion", "PROD"],
    ] as const
  ).map(([stage, environment], stageIndex) => ({
    id: `${group.name.toLowerCase()}-${environment.toLowerCase()}`,
    name: `${group.name} · ${stage}`,
    kind: group.kind,
    host: group.host,
    database: `${group.name.toLowerCase()}_${environment.toLowerCase()}`,
    environment,
    status: stageIndex === 2 && groupIndex % 4 === 0 ? "offline" : "unknown",
  })),
);

const manyConnections = [...baseConnections, ...denseConnections];

export function ConnectionSelectPreview({ variant, many }: { variant: Variant; many: boolean }) {
  const reduceMotion = useReducedMotion();
  const connections = many ? manyConnections : baseConnections;
  const servers = ["Alle", ...new Set(connections.map((connection) => connection.host))];
  const [selectedId, setSelectedId] = useState("staging");
  const [favorites, setFavorites] = useState(["staging", "local"]);
  const [query, setQuery] = useState("");
  const [server, setServer] = useState("Alle");
  const [open, setOpen] = useState(variant !== "command");
  const [panelHeight, setPanelHeight] = useState(40);
  const [highlighted, setHighlighted] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (variant !== "command") return;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (open) searchRef.current?.focus();
      else triggerRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open, variant]);

  useLayoutEffect(() => {
    if (variant !== "command" || !open || !panelRef.current) return;
    const panel = panelRef.current;
    const measure = () => setPanelHeight(panel.offsetHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [open, variant]);
  const selected = connections.find((connection) => connection.id === selectedId) ?? connections[0];
  const matches = connections.filter((connection) => {
    const target =
      `${connection.name} ${connection.host} ${connection.database} ${connection.environment} ${connection.kind}`.toLowerCase();
    return (
      target.includes(query.toLowerCase().trim()) &&
      (variant !== "server" || server === "Alle" || connection.host === server)
    );
  });
  const visible =
    variant === "clear" || variant === "command"
      ? [...matches].sort((a, b) => {
          const priority = (connection: DemoConnection) =>
            connection.id === selectedId ? 0 : favorites.includes(connection.id) ? 1 : 2;
          return priority(a) - priority(b);
        })
      : matches;

  function select(id: string) {
    setSelectedId(id);
    setOpen(false);
    setQuery("");
    setHighlighted(0);
  }

  function toggleFavorite(id: string) {
    setFavorites((current) =>
      current.includes(id) ? current.filter((favorite) => favorite !== id) : [...current, id],
    );
  }

  const search = (
    <div
      className={cn(
        "flex h-9 items-center gap-2 px-3",
        variant === "command" ? "border-b border-border/70" : "mx-2 rounded-md bg-muted/55",
      )}
    >
      <Search className="size-3.5 shrink-0 text-muted-foreground" />
      <input
        ref={variant === "command" ? searchRef : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(0);
        }}
        onKeyDown={(event) => {
          if (variant === "command" && event.altKey && /^[1-3]$/.test(event.key)) {
            const connection = visible[Number(event.key) - 1];
            if (connection) {
              event.preventDefault();
              select(connection.id);
            }
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((current) =>
              visible.length
                ? (current + (event.key === "ArrowDown" ? 1 : -1) + visible.length) % visible.length
                : 0,
            );
          }
          if (event.key === "Enter" && visible.length)
            select(visible[Math.min(highlighted, visible.length - 1)].id);
          if (event.key === "Escape") setOpen(false);
        }}
        placeholder={
          variant === "command" ? "Verbindung oder Host suchen…" : "Verbindungen suchen…"
        }
        aria-label={`Verbindungen suchen, Variante ${variant}`}
        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/80"
      />
      {variant === "command" && (
        <button
          type="button"
          aria-label="Schnellwechsel schließen"
          onClick={() => setOpen(false)}
          className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );

  return (
    <motion.div
      initial={false}
      animate={variant === "command" ? { height: open ? panelHeight : 40 } : undefined}
      transition={{
        height: reduceMotion
          ? { duration: 0 }
          : open
            ? { type: "spring", stiffness: 300, damping: 28, mass: 0.82 }
            : { duration: 0.26, ease: [0.4, 0, 0.2, 1] },
      }}
      className={cn(
        variant === "command"
          ? "relative overflow-hidden rounded-xl border border-border/80 bg-popover shadow-lg shadow-foreground/5"
          : "space-y-2",
      )}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {(!open || variant !== "command") && (
          <motion.button
            key="trigger"
            ref={variant === "command" ? triggerRef : undefined}
            type="button"
            aria-expanded={open}
            aria-label={`Verbindung wählen, aktuell ${selected.name}`}
            onClick={() => setOpen(!open)}
            className={cn(
              "flex w-full min-w-0 items-center text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              variant === "command"
                ? "h-10 gap-2.5 bg-card px-3 hover:bg-muted/50"
                : variant === "cards"
                  ? "h-14 gap-3 rounded-xl border bg-card px-3 shadow-sm hover:bg-muted/40"
                  : variant === "server"
                    ? "h-12 gap-2.5 rounded-lg border bg-card px-3 hover:bg-muted/40"
                    : "h-12 gap-2.5 rounded-xl border bg-card px-3 hover:bg-muted/40",
            )}
          >
            <span
              className={cn(
                "grid size-7 shrink-0 place-items-center rounded-md",
                variant === "clear" ? "bg-primary/8" : "bg-muted",
              )}
            >
              <ProviderLogo kind={selected.kind} className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="truncate text-xs font-medium">{selected.name}</span>
                <span className="shrink-0 rounded bg-primary/10 px-1 py-0.5 font-mono text-[9px] leading-none text-primary">
                  {selected.environment}
                </span>
              </span>
              {variant !== "command" && (
                <span className="block truncate font-mono text-[10px] text-muted-foreground">
                  {selected.database} · {selected.host}
                </span>
              )}
            </span>
            {variant === "command" ? (
              <Command className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
            )}
          </motion.button>
        )}
        {open && (
          <motion.div
            key="panel"
            ref={variant === "command" ? panelRef : undefined}
            initial={variant === "command" && !reduceMotion ? { opacity: 0, y: 5 } : false}
            animate={{ opacity: 1, y: 0 }}
            exit={
              variant === "command" && !reduceMotion
                ? { opacity: 0, transition: { duration: 0.09, ease: "easeOut" } }
                : undefined
            }
            transition={{
              duration: 0.18,
              ease: "easeOut",
              delay: variant === "command" && !reduceMotion ? 0.04 : 0,
            }}
            className={cn(
              "overflow-hidden border border-border/80 bg-popover text-popover-foreground shadow-lg shadow-foreground/5",
              variant === "command"
                ? "border-0 shadow-none"
                : variant === "cards"
                  ? "rounded-xl p-2"
                  : "rounded-xl",
            )}
          >
            {variant === "clear" && (
              <div className="flex items-center justify-between px-3 pb-2 pt-3">
                <span className="text-xs font-medium">Verbindung wechseln</span>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                  {connections.length} gespeichert
                </span>
              </div>
            )}
            {variant === "server" && (
              <div className="border-b border-border/60 px-3 pb-2 pt-3">
                <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
                  <Server className="size-3.5 text-muted-foreground" /> Server wählen
                </div>
                {many ? (
                  <select
                    value={server}
                    onChange={(event) => setServer(event.target.value)}
                    aria-label="Server wählen"
                    className="h-8 w-full rounded-md border border-border bg-card px-2 font-mono text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {servers.map((item) => (
                      <option key={item} value={item}>
                        {item === "Alle"
                          ? `Alle Server (${servers.length - 1})`
                          : `${item} (${connections.filter((connection) => connection.host === item).length})`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                    {servers.map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={server === item}
                        onClick={() => setServer(item)}
                        className={cn(
                          "shrink-0 rounded-md px-2 py-1 font-mono text-[10px] transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                          server === item
                            ? "bg-primary text-primary-foreground"
                            : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {item === "db.shop.example"
                          ? "Shop-Server"
                          : item === "localhost:5432"
                            ? "Lokal"
                            : item === "data.example"
                              ? "Analytics"
                              : item === "Lokale Datei"
                                ? "Dateien"
                                : item}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {variant === "cards" && (
              <div className="flex items-center justify-between px-1 pb-2 pt-1">
                <span className="text-xs font-semibold">Meine Verbindungen</span>
                <span className="text-[10px] text-muted-foreground">Status & Details</span>
              </div>
            )}
            {search}
            {variant !== "command" && <div className="h-2" />}
            <div
              className={cn(
                "max-h-[320px] overflow-y-auto",
                variant === "cards" ? "space-y-1" : "pb-1",
              )}
            >
              {visible.length === 0 ? (
                <div className="flex min-h-20 items-center justify-center px-3 text-xs text-muted-foreground">
                  Keine Verbindungen gefunden
                </div>
              ) : (
                visible.map((connection, index) => {
                  const active = connection.id === selectedId;
                  const favorite = favorites.includes(connection.id);
                  const previous = visible[index - 1];
                  const group = active ? "Aktuell" : favorite ? "Favoriten" : "Weitere";
                  const previousGroup = previous
                    ? previous.id === selectedId
                      ? "Aktuell"
                      : favorites.includes(previous.id)
                        ? "Favoriten"
                        : "Weitere"
                    : null;
                  return (
                    <div key={connection.id}>
                      {variant === "clear" && group !== previousGroup && (
                        <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {group}
                        </div>
                      )}
                      {variant === "clear" &&
                        many &&
                        group === "Weitere" &&
                        connection.host !== previous?.host && (
                          <div className="px-3 pb-1 pt-2 font-mono text-[10px] text-muted-foreground">
                            {connection.host}
                          </div>
                        )}
                      {variant === "command" && group !== previousGroup && !query && (
                        <div className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">
                          {group}
                        </div>
                      )}
                      <div className="group relative">
                        <button
                          type="button"
                          onClick={() => select(connection.id)}
                          onMouseEnter={() => setHighlighted(index)}
                          aria-current={active ? "true" : undefined}
                          className={cn(
                            "flex w-full min-w-0 items-center gap-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            variant === "cards"
                              ? "min-h-17 rounded-lg border px-2.5 py-2"
                              : variant === "command"
                                ? "h-11 px-3"
                                : "h-12 px-3",
                            variant === "cards"
                              ? active
                                ? "border-primary/35 bg-primary/[0.07]"
                                : "border-border/60 bg-card hover:bg-muted/50"
                              : index === highlighted && variant === "command"
                                ? "bg-primary/9"
                                : active
                                  ? "bg-primary/[0.06]"
                                  : "hover:bg-muted/60",
                          )}
                        >
                          <span
                            className={cn(
                              "grid size-7 shrink-0 place-items-center rounded-md",
                              variant === "cards" ? "bg-muted/80" : "bg-muted/60",
                            )}
                          >
                            <ProviderLogo kind={connection.kind} className="size-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <span className="truncate text-xs font-medium">
                                {connection.name}
                              </span>
                              {(variant === "cards" || variant === "command") && (
                                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[9px] text-muted-foreground">
                                  {connection.environment}
                                </span>
                              )}
                            </span>
                            <span className="block truncate font-mono text-[10px] text-muted-foreground">
                              {variant === "server"
                                ? connection.database
                                : `${connection.database} · ${connection.host}`}
                            </span>
                            {variant === "cards" && (
                              <span className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                                <span
                                  className={cn(
                                    "size-1.5 rounded-full",
                                    connection.status === "online"
                                      ? "bg-emerald-500"
                                      : connection.status === "offline"
                                        ? "bg-rose-400"
                                        : "bg-muted-foreground/50",
                                  )}
                                />
                                {connection.status === "online"
                                  ? "Erreichbar"
                                  : connection.status === "offline"
                                    ? "Offline"
                                    : "Nicht geprüft"}
                              </span>
                            )}
                          </span>
                          {variant === "command" && index < 3 && (
                            <kbd className="shrink-0 rounded border px-1 font-mono text-[10px] text-muted-foreground">
                              {index + 1}
                            </kbd>
                          )}
                          {variant !== "command" && active && (
                            <Check className="size-3.5 shrink-0 text-primary" />
                          )}
                        </button>
                        {variant !== "command" && (
                          <button
                            type="button"
                            aria-label={
                              favorite
                                ? `${connection.name} aus Favoriten entfernen`
                                : `${connection.name} zu Favoriten hinzufügen`
                            }
                            aria-pressed={favorite}
                            onClick={() => toggleFavorite(connection.id)}
                            className={cn(
                              "absolute right-2 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-md transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
                              variant === "cards" ? "top-5" : "",
                              favorite
                                ? "text-amber-500"
                                : "text-muted-foreground/60 opacity-60 group-hover:opacity-100 group-focus-within:opacity-100",
                              active && "right-7",
                            )}
                          >
                            <Star className={cn("size-3.5", favorite && "fill-current")} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {variant === "server" && (
              <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
                <Database className="size-3" /> {visible.length}{" "}
                {visible.length === 1 ? "Verbindung" : "Verbindungen"}
                {server === "Alle" ? " insgesamt" : " auf diesem Server"}
              </div>
            )}
            {variant === "command" && (
              <div className="flex items-center justify-between border-t border-border/60 px-3 py-2 text-[10px] text-muted-foreground">
                <span>↑ ↓ navigieren · ↵ wählen · ⌥1–3 direkt</span>
                <span>esc schließen</span>
              </div>
            )}
            {variant === "cards" && (
              <div className="flex items-center justify-between px-1 pb-1 pt-2 text-[10px] text-muted-foreground">
                <span>Favoriten mit ★ markieren</span>
                <ChevronDown className="size-3" />
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
