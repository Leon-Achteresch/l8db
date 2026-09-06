import { useNavigate } from "@tanstack/react-router";
import { Database, Search, Table } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useTablesQuery } from "@/lib/queries";
import { activateConnectionWithToast } from "@/lib/ssh";
import { cn } from "@/lib/utils";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);

const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

export function AppHeaderSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const { data: tables } = useTablesQuery();

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((IS_MAC ? e.metaKey : e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const filteredConnections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? connections.filter((c) => c.name.toLowerCase().includes(q)) : connections;
    return list.slice(0, 8);
  }, [connections, query]);

  const filteredTables = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = tables ?? [];
    const matched = q
      ? list.filter(
          (t) =>
            t.name.toLowerCase().includes(q) ||
            t.schema.toLowerCase().includes(q) ||
            `${t.schema}.${t.name}`.toLowerCase().includes(q),
        )
      : list;
    return matched.slice(0, 15);
  }, [tables, query]);

  const onSelectConnection = useCallback(
    async (id: string) => {
      setOpen(false);
      if (await activateConnectionWithToast(id)) await navigate({ to: "/" });
    },
    [navigate],
  );

  const onSelectTable = useCallback(
    (schema: string, table: string) => {
      setOpen(false);
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema, table },
      });
    },
    [navigate],
  );

  const handleOpenChange = useCallback((next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  }, []);

  const hasResults = filteredConnections.length > 0 || filteredTables.length > 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        className={cn(
          "inline-flex h-[26px] w-full max-w-[460px] items-center gap-2 rounded-lg",
          "border border-border/50 bg-muted/30 px-2.5",
          "text-xs text-muted-foreground transition-colors",
          "cursor-pointer select-none",
          "hover:border-border/70 hover:bg-muted/50",
        )}
      >
        <Search className="size-3.5 shrink-0 opacity-50" strokeWidth={2} />
        <span className="rounded border border-border/40 bg-background/80 px-1.5 py-px text-[10px] font-semibold text-foreground/80">
          l8db
        </span>
        <span className="min-w-0 flex-1 truncate text-left opacity-50">
          Tabellen und Verbindungen suchen…
        </span>
        <kbd className="inline-flex shrink-0 items-center gap-px rounded border border-border/50 bg-background/60 px-1.5 py-px font-sans text-[10px] text-muted-foreground">
          {MOD_KEY}K
        </kbd>
      </button>

      <CommandDialog
        open={open}
        onOpenChange={handleOpenChange}
        title="Suche"
        description="Tabellen und Verbindungen durchsuchen"
      >
        <Command shouldFilter={false}>
          <CommandInput placeholder="Suchen…" value={query} onValueChange={setQuery} />
          <CommandList>
            {!hasResults && <CommandEmpty>Keine Treffer</CommandEmpty>}

            {filteredConnections.length > 0 && (
              <CommandGroup heading="Verbindungen">
                {filteredConnections.map((connection) => (
                  <CommandItem
                    key={`connection:${connection.id}`}
                    value={`connection:${connection.id}`}
                    onSelect={() => onSelectConnection(connection.id)}
                  >
                    <Database className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-xs">{connection.name}</span>
                    {connection.id === activeConnection?.id ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground">aktiv</span>
                    ) : null}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {filteredConnections.length > 0 && filteredTables.length > 0 && <CommandSeparator />}

            {filteredTables.length > 0 && (
              <CommandGroup heading="Tabellen">
                {filteredTables.map((table) => (
                  <CommandItem
                    key={`table:${table.schema}.${table.name}`}
                    value={`table:${table.schema}.${table.name}`}
                    onSelect={() => onSelectTable(table.schema, table.name)}
                  >
                    <Table className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                      {table.schema}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs">{table.name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          <div className="flex items-center gap-3 border-t border-border/40 px-3 py-1.5 text-[10px] text-muted-foreground/60">
            <span>
              <kbd className="font-sans">↵</kbd> öffnen
            </span>
          </div>
        </Command>
      </CommandDialog>
    </>
  );
}
