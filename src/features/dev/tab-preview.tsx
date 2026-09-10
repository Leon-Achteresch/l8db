import {
  ChevronDown,
  Columns2,
  FolderOpen,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Table2,
  X,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const initialTabs = [
  "ARTIKEL",
  "ABRECHNUNG_NVE",
  "KUNDEN",
  "BESTELLUNGEN",
  "BESTELLPOSITIONEN",
  "LIEFERANTEN",
  "LAGERBESTAND",
  "ZAHLUNGSEINGAENGE",
];
const iconButton =
  "inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function TabPreview({
  variant,
  many,
}: {
  variant: "flat" | "dense" | "minimal";
  many: boolean;
}) {
  const [tabs, setTabs] = useState(initialTabs.slice(0, many ? initialTabs.length : 2));
  const [active, setActive] = useState("ABRECHNUNG_NVE");
  const [sidebar, setSidebar] = useState(false);
  const [split, setSplit] = useState(false);
  const [nextId, setNextId] = useState(1);
  const flat = variant === "flat";
  const minimal = variant === "minimal";
  const actionClass = cn(
    iconButton,
    flat &&
      "rounded-full transition-[color,background-color,transform] duration-200 motion-safe:active:scale-90",
  );

  function closeTab(name: string) {
    const remaining = tabs.filter((tab) => tab !== name);
    setTabs(remaining);
    if (active === name) setActive(remaining[Math.max(0, tabs.indexOf(name) - 1)] ?? "");
  }

  function addTab() {
    const name = `NEUE_TABELLE_${nextId}`;
    setNextId(nextId + 1);
    setTabs([...tabs, name]);
    setActive(name);
  }

  return (
    <div
      className={cn(
        "overflow-hidden border border-border bg-card",
        flat ? "rounded-xl" : "rounded-md",
      )}
    >
      <div
        aria-label="Tab-Leiste"
        className={cn(
          "flex min-w-0 items-center border-b border-border px-1",
          flat ? "h-9 bg-primary/[0.035] px-1.5" : "h-8",
        )}
      >
        <button
          type="button"
          title="Seitenleiste umschalten"
          aria-label="Seitenleiste umschalten"
          aria-pressed={sidebar}
          onClick={() => setSidebar(!sidebar)}
          className={actionClass}
        >
          <PanelLeft className="size-3.5" />
        </button>
        <span className={cn("mx-1 shrink-0", flat ? "w-0.5" : "h-4 w-px bg-border")} />
        {minimal ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Offene Tabellen"
                className="flex h-7 min-w-0 gap-2 items-center rounded-sm px-2 text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Table2 className="size-3.5 shrink-0 text-emerald-500" />
                <span className="truncate">{active || "Keine Tabelle geöffnet"}</span>
                <ChevronDown className="size-3 shrink-0" />
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {tabs.length}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="min-w-56">
              {tabs.map((tab) => (
                <DropdownMenuItem
                  key={tab}
                  onSelect={() => setActive(tab)}
                  className={cn(active === tab && "bg-muted")}
                >
                  {tab}
                </DropdownMenuItem>
              ))}
              {!tabs.length && <DropdownMenuItem disabled>Keine offenen Tabellen</DropdownMenuItem>}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div
            className={cn(
              "flex h-full min-w-0 overflow-x-auto [scrollbar-width:none]",
              flat ? "items-center gap-1 px-1" : "items-stretch",
            )}
            aria-label="Offene Tabellen"
          >
            {tabs.map((tab) => (
              <div
                key={tab}
                className={cn(
                  "group relative flex shrink-0 items-center text-xs",
                  flat
                    ? "h-7 max-w-56 rounded-full pr-0.5 transition-[background-color,box-shadow,color] duration-200"
                    : "w-[140px] border-r border-border/50",
                  flat
                    ? active === tab
                      ? "bg-card text-foreground font-medium shadow-[0_1px_3px_color-mix(in_oklab,var(--primary)_14%,transparent)] ring-1 ring-inset ring-primary/10"
                      : "text-muted-foreground hover:bg-card/70 hover:text-foreground"
                    : active === tab
                      ? "bg-muted/70 text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary"
                      : "text-muted-foreground hover:bg-muted/40",
                )}
              >
                <button
                  type="button"
                  title={tab}
                  aria-pressed={active === tab}
                  onClick={() => setActive(tab)}
                  className={cn(
                    "flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    flat && "rounded-full pl-1",
                  )}
                >
                  {flat && (
                    <span className="grid size-5 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                      <Table2 className="size-3" />
                    </span>
                  )}
                  <span className="truncate">{tab}</span>
                </button>
                <button
                  type="button"
                  aria-label={`${tab} schließen`}
                  onClick={() => closeTab(tab)}
                  className={cn(
                    actionClass,
                    "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                    active === tab && "opacity-100",
                  )}
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          aria-label="Tabelle hinzufügen"
          title="Tabelle hinzufügen"
          onClick={addTab}
          className={cn(
            actionClass,
            "ml-1",
            flat && "bg-primary/8 text-primary hover:bg-primary/15",
          )}
        >
          <Plus className="size-3.5" />
        </button>
        <div className="min-w-0 flex-1" />
        {flat ? (
          <>
            <button
              type="button"
              aria-label="Ansicht teilen"
              title="Ansicht teilen"
              aria-pressed={split}
              onClick={() => setSplit(!split)}
              className={actionClass}
            >
              <Columns2 className="size-3.5" />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Tabelle öffnen"
                  title="Tabelle öffnen"
                  className={actionClass}
                >
                  <FolderOpen className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {initialTabs.map((tab) => (
                  <DropdownMenuItem
                    key={tab}
                    onSelect={() => {
                      if (!tabs.includes(tab)) setTabs([...tabs, tab]);
                      setActive(tab);
                    }}
                  >
                    {tab}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Weitere Aktionen"
                title="Weitere Aktionen"
                className={iconButton}
              >
                <MoreHorizontal className="size-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-48">
              <DropdownMenuItem onSelect={() => setSplit(!split)}>
                {split ? "Teilung aufheben" : "Ansicht teilen"}
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!active} onSelect={() => closeTab(active)}>
                Aktuellen Tab schließen
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={!tabs.length}
                onSelect={() => {
                  setTabs([]);
                  setActive("");
                }}
              >
                Alle Tabs schließen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="flex h-28 min-w-0 overflow-hidden">
        {sidebar && (
          <aside className="w-28 shrink-0 border-r bg-muted/20 p-3 text-xs text-muted-foreground">
            public<span className="mt-2 block text-foreground">{tabs.length} Tabellen</span>
          </aside>
        )}
        <div className="min-w-0 flex-1 overflow-x-auto">
          {active ? (
            <table className="w-full text-left text-xs">
              <caption className="sr-only">Beispieldaten für {active}</caption>
              <thead className="bg-muted/20 text-muted-foreground">
                <tr>
                  {["id", "Tabelle", "Status", "Aktualisiert"].map((heading) => (
                    <th key={heading} className="h-8 whitespace-nowrap border-b px-3 font-medium">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[1, 2].map((id) => (
                  <tr key={id} className="border-b border-border/40 last:border-0">
                    <td className="h-8 px-3 font-mono text-muted-foreground">{id}</td>
                    <td className="px-3 text-[11px]">{active}</td>
                    <td className="px-3 text-muted-foreground">Aktiv</td>
                    <td className="whitespace-nowrap px-3 tabular-nums text-muted-foreground">
                      07.09.2026
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-6 text-xs text-muted-foreground">
              Keine Tabelle geöffnet. Mit + eine neue hinzufügen.
            </p>
          )}
        </div>
        {split && (
          <aside className="flex w-1/3 shrink-0 items-center justify-center border-l bg-muted/20 p-3 text-xs text-muted-foreground">
            Zweite Ansicht
          </aside>
        )}
      </div>
    </div>
  );
}
