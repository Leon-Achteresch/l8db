import { useNavigate } from "@tanstack/react-router";
import { Database, Search, Sparkles, Table } from "lucide-react";
import { type CSSProperties, useCallback, useMemo, useState } from "react";
import { type CommandItem, CommandPalette } from "@/components/motion/command-palette";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useTablesQuery } from "@/lib/queries";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { useTourStore } from "@/lib/tour/store";
import { cn } from "@/lib/utils";

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

export function AppHeaderSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const { data: tables } = useTablesQuery();

  const onSelectConnection = useCallback(
    async (id: string) => {
      if (useConnectionSwitch.getState().isSwitching) return;
      setOpen(false);
      if (await activateConnectionWithToast(id)) await navigate({ to: "/" });
    },
    [navigate],
  );

  const items = useMemo<CommandItem[]>(() => {
    const connectionItems = connections.map((connection) => ({
      id: `connection:${connection.id}`,
      label: connection.name,
      group: "Verbindungen",
      icon: Database,
      keywords: [connection.kind],
      badge:
        isSwitching && switchTargetId === connection.id
          ? "verbinde…"
          : connection.id === activeConnection?.id
            ? "aktiv"
            : undefined,
      onSelect: () => void onSelectConnection(connection.id),
    }));
    const tableItems = (tables ?? []).slice(0, 40).map((table) => ({
      id: `table:${table.schema}.${table.name}`,
      label: table.name,
      group: "Tabellen",
      icon: Table,
      hint: table.schema,
      keywords: [table.schema, `${table.schema}.${table.name}`],
      onSelect: () => {
        setOpen(false);
        void navigate({
          to: "/tables/$schema/$table",
          params: { schema: table.schema, table: table.name },
        });
      },
    }));
    const tourItem: CommandItem = {
      id: "tour:start",
      label: "Produkttour von vorn",
      group: "Hilfe",
      icon: Sparkles,
      keywords: ["tour", "hilfe", "onboarding", "guide"],
      onSelect: () => {
        setOpen(false);
        useTourStore.getState().startFromBeginning();
      },
    };
    return [...connectionItems, ...tableItems, tourItem];
  }, [activeConnection?.id, connections, navigate, onSelectConnection, tables, isSwitching, switchTargetId]);

  return (
    <>
      <button
        type="button"
        data-tour="header-search"
        onClick={() => setOpen(true)}
        style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
        className={cn(
          "inline-flex h-7 w-full max-w-[460px] items-center gap-2 rounded-full",
          "border border-border/70 bg-muted/40 px-3",
          "text-xs text-muted-foreground transition-colors",
          "cursor-pointer select-none",
          "hover:border-primary/35 hover:bg-card",
        )}
      >
        <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate text-left">Suchen</span>
        <kbd className="inline-flex shrink-0 items-center rounded-full border border-border/60 bg-background/70 px-1.5 py-px font-sans text-[10px]">
          {MOD_KEY}K
        </kbd>
      </button>
      <CommandPalette
        items={items}
        open={open}
        onOpenChange={setOpen}
        placeholder="Tabellen und Verbindungen…"
        emptyMessage="Keine Treffer"
      />
    </>
  );
}
