import { useNavigate } from "@tanstack/react-router";
import { Braces, Database, Eye, Keyboard, Search, Sparkles, Table, TextSearch } from "lucide-react";
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from "react";
import { type CommandItem, CommandPalette } from "@/components/motion/command-palette";
import { ObjectSearchDialog } from "@/features/objects/object-search-dialog";
import { ShortcutsDialog } from "@/features/shell/shortcuts-dialog";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import {
  buildObjectEntries,
  OBJECT_TYPE_PLURAL,
  objectEntryHint,
  objectEntryKeywords,
} from "@/lib/object-search";
import { supports } from "@/lib/providers";
import { useAllSchemaObjectsQuery } from "@/lib/queries";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { useTourStore } from "@/lib/tour/store";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_RESULTS = 60;

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
const MOD_KEY = IS_MAC ? "⌘" : "Ctrl";

export function AppHeaderSearch() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const connections = useConnectionsStore((state) => state.connections);
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const [objectSearchOpen, setObjectSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { data: objects } = useAllSchemaObjectsQuery(open);
  const canSearchColumns = supports(activeConnection, "column_search");
  const canSearchSource = supports(activeConnection, "source_search");

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== "/") return;
      event.preventDefault();
      setShortcutsOpen((previous) => !previous);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
    const objectItems = buildObjectEntries(objects ?? {}).map((entry) => ({
      id: entry.key,
      label: entry.name,
      group: OBJECT_TYPE_PLURAL[entry.type],
      icon: entry.type === "table" ? Table : entry.type === "view" ? Eye : Braces,
      hint: objectEntryHint(entry),
      keywords: objectEntryKeywords(entry),
      onSelect: () => {
        setOpen(false);
        if (entry.type === "procedure") {
          void navigate({
            to: "/procedures/$schema/$name",
            params: { schema: entry.schema, name: entry.name },
            search: { oid: entry.oid },
          });
          return;
        }
        if (entry.type === "routine") {
          void navigate({
            to: "/functions/$schema/$name",
            params: { schema: entry.schema, name: entry.name },
            search: { oid: entry.oid },
          });
          return;
        }
        if (entry.type === "view") {
          void navigate({
            to: "/view-editor/$schema/$view",
            params: { schema: entry.schema, view: entry.name },
          });
          return;
        }
        void navigate({
          to: "/tables/$schema/$table",
          params: { schema: entry.schema, table: entry.name },
        });
      },
    }));
    const deepSearchItem: CommandItem[] =
      canSearchColumns || canSearchSource
        ? [
            {
              id: "objects:deep-search",
              label: "Spalten und Quelltext durchsuchen",
              group: "Objekte",
              icon: TextSearch,
              keywords: ["spalte", "column", "quelltext", "source", "suche"],
              onSelect: () => {
                setOpen(false);
                setObjectSearchOpen(true);
              },
            },
          ]
        : [];
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
    const shortcutsItem: CommandItem = {
      id: "help:shortcuts",
      label: "Tastenkürzel anzeigen",
      group: "Hilfe",
      icon: Keyboard,
      hint: "Cmd/Ctrl+/",
      keywords: ["tastenkürzel", "shortcut", "tastatur", "hilfe", "keyboard"],
      onSelect: () => {
        setOpen(false);
        setShortcutsOpen(true);
      },
    };
    return [...connectionItems, ...deepSearchItem, ...objectItems, tourItem, shortcutsItem];
  }, [
    activeConnection?.id,
    canSearchColumns,
    canSearchSource,
    connections,
    navigate,
    objects,
    onSelectConnection,
    isSwitching,
    switchTargetId,
  ]);

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
        placeholder="Objekte und Verbindungen…"
        emptyMessage="Keine Treffer"
        maxVisible={MAX_VISIBLE_RESULTS}
      />
      <ObjectSearchDialog open={objectSearchOpen} onOpenChange={setObjectSearchOpen} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
