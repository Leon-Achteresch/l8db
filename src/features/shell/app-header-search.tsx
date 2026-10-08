import { useHotkey, useHotkeys } from "@tanstack/react-hotkeys";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Database, Keyboard, Plug, Puzzle, Search, Sparkles, TextSearch } from "lucide-react";
import {
  type CSSProperties,
  lazy,
  Suspense,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { type CommandItem, CommandPalette } from "@/components/motion/command-palette";
import { NewBadge } from "@/components/new-badge";
import { DynamicIsland } from "@/features/shell/dynamic-island";
import { useAiStore } from "@/lib/ai/store";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useExtensionHost } from "@/lib/extensions/react-context";
import {
  commandById,
  formatHotkeyDisplay,
  onHotkeyAction,
  useHotkeysStore,
  useResolvedHotkey,
} from "@/lib/hotkeys";
import { markNewFeatureSeen, useHasNewFeatures } from "@/lib/new-features";
import { useNotebookStore } from "@/lib/notebook/store";
import { usePaletteHistoryStore } from "@/lib/palette-history";
import { supports } from "@/lib/providers";
import { useAllSchemaObjectsQuery } from "@/lib/queries";
import { useSettingsStore } from "@/lib/settings";
import { activateConnectionWithToast, useConnectionSwitch } from "@/lib/ssh";
import { useTourStore } from "@/lib/tour/store";
import { cn } from "@/lib/utils";

const MAX_VISIBLE_RESULTS = 60;
const NO_ITEMS: CommandItem[] = [];
const ObjectSearchDialog = lazy(() =>
  import("@/features/objects/object-search-dialog").then(({ ObjectSearchDialog }) => ({
    default: ObjectSearchDialog,
  })),
);
const ShortcutsDialog = lazy(() =>
  import("@/features/shell/shortcuts-dialog").then(({ ShortcutsDialog }) => ({
    default: ShortcutsDialog,
  })),
);

export function AppHeaderSearch() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const dynamicIsland = useSettingsStore((state) => state.dynamicIsland);
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [builders, setBuilders] = useState<typeof import("./app-header-search/command-items")>();
  const [initialQuery, setInitialQuery] = useState("");
  const paletteHistory = usePaletteHistoryStore((state) => state.history);
  const recordPaletteUse = usePaletteHistoryStore((state) => state.record);
  const openSearch = useCallback((commandsOnly = false) => {
    setInitialQuery(commandsOnly ? "> " : "");
    setOpen(true);
  }, []);
  const pathname = useRouterState({ select: (state) => (open ? state.location.pathname : "") });
  const connections = useConnectionsStore((state) => state.connections);
  const recentNotebooks = useNotebookStore((state) => state.recent);
  const activeConnection = useActiveConnection();
  const isSwitching = useConnectionSwitch((state) => state.isSwitching);
  const switchTargetId = useConnectionSwitch((state) => state.targetId);
  const [objectSearchOpen, setObjectSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const objectSearchMounted = useRef(false);
  const shortcutsMounted = useRef(false);
  if (objectSearchOpen) objectSearchMounted.current = true;
  if (shortcutsOpen) shortcutsMounted.current = true;
  const { data: objects } = useAllSchemaObjectsQuery(open && Boolean(builders));
  const canSearchColumns = supports(activeConnection, "column_search");
  const canSearchSource = supports(activeConnection, "source_search");
  const extensionHost = useExtensionHost();
  const [extensionVersion, setExtensionVersion] = useState(0);
  const hotkeyOverrideVersion = useHotkeysStore((state) => state.overrides);
  const searchButtonRef = useRef<HTMLButtonElement | null>(null);
  const paletteHotkey = useResolvedHotkey("palette.open");
  const quickOpenHotkey = useResolvedHotkey("palette.quickOpen");
  const shortcutsHotkey = useResolvedHotkey("shortcuts.open");
  const focusSearchHotkey = useResolvedHotkey("app.focusSearch");

  useEffect(() => {
    if (!open || builders) return;
    let active = true;
    void import("./app-header-search/command-items")
      .then((module) => {
        if (active) startTransition(() => setBuilders(module));
      })
      .catch((error) => {
        if (active) toast.error(`Suchbefehle konnten nicht geladen werden: ${String(error)}`);
      });
    return () => {
      active = false;
    };
  }, [open, builders]);

  useEffect(() => {
    const subscription = extensionHost.changes.on("change", () =>
      setExtensionVersion((value) => value + 1),
    );
    return () => subscription.dispose();
  }, [extensionHost]);

  useHotkeys(
    [
      {
        hotkey: paletteHotkey,
        callback: () => {
          if (open) setOpen(false);
          else openSearch();
        },
        options: { ignoreInputs: false },
      },
      {
        hotkey: quickOpenHotkey,
        callback: () => openSearch(),
        options: { ignoreInputs: false },
      },
      {
        hotkey: shortcutsHotkey,
        callback: () => setShortcutsOpen((previous) => !previous),
        options: { ignoreInputs: false },
      },
      {
        hotkey: focusSearchHotkey,
        callback: () => searchButtonRef.current?.focus(),
        options: { ignoreInputs: false },
      },
    ],
    { preventDefault: true, stopPropagation: true },
  );

  useHotkey(
    (commandById("palette.open")?.aliases?.[0] ?? "Mod+Shift+P") as never,
    () => openSearch(true),
    { ignoreInputs: false, preventDefault: true, stopPropagation: true },
  );

  useEffect(() => onHotkeyAction("objects.search", () => setObjectSearchOpen(true)), []);
  useEffect(() => onHotkeyAction("app.focusSearch", () => openSearch()), [openSearch]);
  useEffect(() => onHotkeyAction("shortcuts.open", () => setShortcutsOpen(true)), []);

  const onSelectConnection = useCallback(
    async (id: string) => {
      if (useConnectionSwitch.getState().isSwitching) return;
      setOpen(false);
      if (await activateConnectionWithToast(id)) await navigate({ to: "/" });
    },
    [navigate],
  );

  const extensionItems = useMemo<CommandItem[]>(() => {
    void extensionVersion;
    return extensionHost.commands.paletteCommands().map((command) => ({
      id: `extension:${command.id}`,
      label: command.title,
      kind: "command",
      group: "Extensions",
      icon: Puzzle,
      keywords: [command.id, command.owner],
      onSelect: () => {
        setOpen(false);
        void extensionHost.executeCommand(command.id).catch((error) => toast.error(String(error)));
      },
    }));
  }, [extensionHost, extensionVersion]);

  const askNew = useHasNewFeatures("ai.ask");
  const searchNew = useHasNewFeatures("search");
  const askAiItem = useCallback(
    (query: string): CommandItem => ({
      id: "ai:ask",
      label: `KI fragen: „${query}“`,
      group: "KI",
      icon: Sparkles,
      badge: askNew ? <NewBadge /> : undefined,
      onSelect: () => {
        markNewFeatureSeen("ai.ask");
        setOpen(false);
        useAiStore.getState().ask(query);
      },
    }),
    [askNew],
  );
  const objectItems = useMemo(
    () => builders?.buildObjectItems(objects, setOpen, navigate) ?? NO_ITEMS,
    [builders, objects, navigate],
  );
  const settingsItems = useMemo(
    () => builders?.buildSettingsItems(setOpen, navigate) ?? NO_ITEMS,
    [builders, navigate],
  );

  const items = useMemo<CommandItem[]>(() => {
    void hotkeyOverrideVersion;
    if (!open || !builders) return NO_ITEMS;
    const connectionItems = connections.map((connection) => ({
      id: `connection:${connection.id}`,
      label: connection.name,
      kind: "connection" as const,
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
    const connectionManagerItem: CommandItem = {
      id: "connections:manage",
      label: "Verbindungen verwalten",
      kind: "command",
      group: "Befehle",
      context: "Verbindungen",
      icon: Plug,
      keywords: ["connection", "manager", "verbindung", "hinzufügen", "neu", "bearbeiten"],
      onSelect: () => {
        setOpen(false);
        void navigate({ to: "/connections" });
      },
    };
    const deepSearchItem: CommandItem[] =
      canSearchColumns || canSearchSource
        ? [
            {
              id: "objects:deep-search",
              label: "Spalten und Quelltext durchsuchen",
              kind: "command",
              group: "Befehle",
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
      kind: "command",
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
      kind: "command",
      group: "Hilfe",
      icon: Keyboard,
      hint: formatHotkeyDisplay(shortcutsHotkey),
      keywords: ["tastenkürzel", "shortcut", "tastatur", "hilfe", "keyboard"],
      onSelect: () => {
        setOpen(false);
        setShortcutsOpen(true);
      },
    };
    const notebookItems = activeConnection
      ? builders.buildNotebookItems(recentNotebooks, activeConnection.id, setOpen, navigate)
      : [];
    const hotkeyItems = builders.buildHotkeyItems(
      pathname,
      activeConnection !== null,
      setOpen,
      setShortcutsOpen,
      easyMode,
    );
    const diagramExportItems = builders.buildDiagramExportItems(
      pathname,
      activeConnection !== null,
    );
    return [
      ...connectionItems,
      connectionManagerItem,
      ...deepSearchItem,
      ...objectItems,
      ...notebookItems,
      ...compareItems,
      ...extensionItems,
      ...hotkeyItems,
      ...diagramExportItems,
      tourItem,
      shortcutsItem,
      ...settingsItems,
    ];
  }, [
    activeConnection?.id,
    activeConnection,
    canSearchColumns,
    canSearchSource,
    connections,
    extensionItems,
    navigate,
    recentNotebooks,
    objectItems,
    settingsItems,
    onSelectConnection,
    isSwitching,
    switchTargetId,
    shortcutsHotkey,
    hotkeyOverrideVersion,
    easyMode,
    pathname,
    open,
    builders,
  ]);

  const searchButton = useMemo(
    () =>
      dynamicIsland ? (
        <DynamicIsland
          buttonRef={searchButtonRef}
          shortcut={formatHotkeyDisplay(paletteHotkey)}
          badge={searchNew ? <NewBadge /> : undefined}
          onOpen={() => openSearch()}
        />
      ) : (
        <button
          type="button"
          ref={searchButtonRef}
          data-tour="header-search"
          data-toast-origin
          aria-label="Suchen"
          onClick={() => openSearch()}
          style={{ WebkitAppRegion: "no-drag" } as CSSProperties}
          className={cn(
            "inline-flex h-7 w-full max-w-[460px] items-center gap-2 rounded-full",
            "border border-border/70 bg-muted/40 px-3 @max-[8rem]/header-search:gap-0 @max-[8rem]/header-search:px-1.5",
            "text-xs text-muted-foreground transition-colors",
            "cursor-pointer select-none",
            "hover:border-primary/35 hover:bg-card",
          )}
        >
          <Search className="size-3.5 shrink-0 opacity-60" strokeWidth={2} />
          <span className="min-w-0 flex-1 truncate text-left @max-[8rem]/header-search:hidden">
            Suchen
          </span>
          {searchNew ? <NewBadge /> : null}
          <kbd className="inline-flex shrink-0 items-center rounded-full border border-border/60 @max-[8rem]/header-search:hidden bg-background/70 px-1.5 py-px font-sans text-[10px]">
            {formatHotkeyDisplay(paletteHotkey)}
          </kbd>
        </button>
      ),
    [dynamicIsland, openSearch, paletteHotkey, searchNew],
  );

  return (
    <>
      {searchButton}
      <CommandPalette
        lockDocumentScroll={false}
        items={items}
        open={open}
        onOpenChange={setOpen}
        placeholder="Suchen… · > für Befehle"
        emptyMessage={builders ? "Keine Treffer" : "Suchbefehle laden…"}
        maxVisible={MAX_VISIBLE_RESULTS}
        featureId="search.fuzzy"
        queryItem={askAiItem}
        initialQuery={initialQuery}
        commandFeatureId="search.commands"
        history={paletteHistory}
        onSelectItem={(item) => recordPaletteUse(item.id)}
      />
      {objectSearchMounted.current && (
        <Suspense fallback={null}>
          <ObjectSearchDialog open={objectSearchOpen} onOpenChange={setObjectSearchOpen} />
        </Suspense>
      )}
      {shortcutsMounted.current && (
        <Suspense fallback={null}>
          <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
        </Suspense>
      )}
    </>
  );
}
