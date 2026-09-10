import type { Hotkey } from "@tanstack/react-hotkeys";
import { formatForDisplay, validateHotkey } from "@tanstack/react-hotkeys";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type { Hotkey };

export type HotkeyArea = "Allgemein" | "Tabs" | "Navigation" | "SQL-Editor" | "Datengitter";

export type HotkeyOrigin = "Chrome" | "VS Code" | "l8db";

export interface HotkeyCommand {
  id: string;
  label: string;
  description: string;
  area: HotkeyArea;
  defaultHotkey: Hotkey;
  aliases?: Hotkey[];
  requiresConnection?: boolean;
  ignoreInputs?: boolean;
  origin: HotkeyOrigin;
  reference?: string;
  routeScope?: "query" | "data";
}

export const HOTKEY_AREAS: HotkeyArea[] = [
  "Allgemein",
  "Tabs",
  "Navigation",
  "SQL-Editor",
  "Datengitter",
];

export const HOTKEY_COMMANDS: HotkeyCommand[] = [
  {
    id: "palette.open",
    label: "Suche und Befehlspalette öffnen",
    description: "Command Palette für Verbindungen, Objekte und Aktionen",
    area: "Allgemein",
    defaultHotkey: "Mod+K",
    aliases: ["Mod+Shift+P"],
    origin: "VS Code",
    reference: "VS Code: Strg+Umschalt+P, Chrome:Adressleisten-Suche",
  },
  {
    id: "palette.quickOpen",
    label: "Schnell öffnen",
    description: "Direkt zu Tabellen, Views und Abfragen springen",
    area: "Allgemein",
    defaultHotkey: "Mod+P",
    origin: "VS Code",
    reference: "VS Code: Strg+P Quick Open",
  },
  {
    id: "shortcuts.open",
    label: "Tastenkürzelhilfe öffnen",
    description: "Übersicht aller Befehle und eigene Belegung",
    area: "Allgemein",
    defaultHotkey: "F1",
    aliases: ["Mod+."],
    origin: "VS Code",
    reference: "VS Code: F1 Befehlspalette/Hilfe",
  },
  {
    id: "settings.open",
    label: "Einstellungen öffnen",
    description: "App-Einstellungen inklusive Hotkey-Konfiguration",
    area: "Allgemein",
    defaultHotkey: "Mod+,",
    origin: "VS Code",
    reference: "VS Code: Strg+,",
  },
  {
    id: "sidebar.toggle",
    label: "Seitenleiste ein- oder ausblenden",
    description: "Explorer/Sidebar umschalten",
    area: "Allgemein",
    defaultHotkey: "Mod+B",
    origin: "VS Code",
    reference: "VS Code: Strg+B",
  },
  {
    id: "dialog.close",
    label: "Dialog oder Overlay schließen",
    description: "Schließt Palette, Dialoge und Suchfelder",
    area: "Allgemein",
    defaultHotkey: "Escape",
    ignoreInputs: false,
    origin: "l8db",
  },
  {
    id: "app.refresh",
    label: "Aktuelle Ansicht neu laden",
    description: "Lädt Objekte der aktiven Verbindung neu, im Query-Editor: Abfrage ausführen",
    area: "Allgemein",
    defaultHotkey: "F5",
    aliases: ["Mod+R"],
    requiresConnection: false,
    ignoreInputs: false,
    origin: "Chrome",
    reference: "Chrome: F5 / Strg+R Neuladen",
  },
  {
    id: "app.focusSearch",
    label: "Suche fokussieren",
    description: "Springt in die Kopf-Suche wie in die Adressleiste",
    area: "Allgemein",
    defaultHotkey: "Mod+L",
    origin: "Chrome",
    reference: "Chrome: Strg+L Adressleiste",
  },
  {
    id: "tab.newQuery",
    label: "Neuen Abfrage-Tab öffnen",
    description: "Neuer Tab wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+T",
    origin: "Chrome",
    reference: "Chrome: Strg+T Neuer Tab",
  },
  {
    id: "tab.close",
    label: "Aktiven Tab schließen",
    description: "Schließt den sichtbaren Arbeits-Tab",
    area: "Tabs",
    defaultHotkey: "Mod+W",
    origin: "Chrome",
    reference: "Chrome: Strg+W Tab schließen",
  },
  {
    id: "tab.reopen",
    label: "Geschlossenen Tab wieder öffnen",
    description: "Stellt den zuletzt geschlossenen Tab wieder her",
    area: "Tabs",
    defaultHotkey: "Mod+Shift+T",
    origin: "Chrome",
    reference: "Chrome: Strg+Umschalt+T",
  },
  {
    id: "tab.next",
    label: "Nächster Tab",
    description: "Wechselt zum Tab rechts",
    area: "Tabs",
    defaultHotkey: "Mod+PageDown",
    aliases: ["Control+Tab"],
    origin: "Chrome",
    reference: "Chrome: Strg+Tab",
  },
  {
    id: "tab.prev",
    label: "Vorheriger Tab",
    description: "Wechselt zum Tab links",
    area: "Tabs",
    defaultHotkey: "Mod+PageUp",
    aliases: ["Control+Shift+Tab"],
    origin: "Chrome",
    reference: "Chrome: Strg+Umschalt+Tab",
  },
  {
    id: "tab.jump1",
    label: "Zu Tab 1 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+1",
    origin: "Chrome",
    reference: "Chrome: Strg+1",
  },
  {
    id: "tab.jump2",
    label: "Zu Tab 2 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+2",
    origin: "Chrome",
    reference: "Chrome: Strg+2",
  },
  {
    id: "tab.jump3",
    label: "Zu Tab 3 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+3",
    origin: "Chrome",
    reference: "Chrome: Strg+3",
  },
  {
    id: "tab.jump4",
    label: "Zu Tab 4 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+4",
    origin: "Chrome",
    reference: "Chrome: Strg+4",
  },
  {
    id: "tab.jump5",
    label: "Zu Tab 5 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+5",
    origin: "Chrome",
    reference: "Chrome: Strg+5",
  },
  {
    id: "tab.jump6",
    label: "Zu Tab 6 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+6",
    origin: "Chrome",
    reference: "Chrome: Strg+6",
  },
  {
    id: "tab.jump7",
    label: "Zu Tab 7 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+7",
    origin: "Chrome",
    reference: "Chrome: Strg+7",
  },
  {
    id: "tab.jump8",
    label: "Zu Tab 8 springen",
    description: "Direktsprung wie im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+8",
    origin: "Chrome",
    reference: "Chrome: Strg+8",
  },
  {
    id: "tab.last",
    label: "Zum letzten Tab springen",
    description: "Wie Strg+9 im Browser",
    area: "Tabs",
    defaultHotkey: "Mod+9",
    origin: "Chrome",
    reference: "Chrome: Strg+9",
  },
  {
    id: "view.split",
    label: "Ansicht teilen",
    description: "Aktiven Tab in Split-Ansicht öffnen",
    area: "Tabs",
    defaultHotkey: "Mod+\\",
    origin: "VS Code",
    reference: "VS Code: Editor teilen",
  },
  {
    id: "go.home",
    label: "Zur Startseite",
    description: "Zurück zur Übersicht",
    area: "Navigation",
    defaultHotkey: "Alt+Home",
    origin: "Chrome",
    reference: "Chrome: Alt+Pos1",
  },
  {
    id: "go.back",
    label: "Zurück navigieren",
    description: "Verlauf zurück wie im Browser",
    area: "Navigation",
    defaultHotkey: "Alt+ArrowLeft",
    origin: "Chrome",
    reference: "Chrome: Alt+Links",
  },
  {
    id: "go.forward",
    label: "Vorwärts navigieren",
    description: "Verlauf vorwärts wie im Browser",
    area: "Navigation",
    defaultHotkey: "Alt+ArrowRight",
    origin: "Chrome",
    reference: "Chrome: Alt+Rechts",
  },
  {
    id: "go.connections",
    label: "Zu Verbindungen",
    description: "Verbindungsübersicht öffnen",
    area: "Navigation",
    defaultHotkey: "Mod+Shift+C",
    origin: "l8db",
  },
  {
    id: "objects.search",
    label: "Spalten und Quelltext durchsuchen",
    description: "Deep Search über Schema-Objekte",
    area: "Navigation",
    defaultHotkey: "Mod+Shift+O",
    requiresConnection: true,
    origin: "VS Code",
    reference: "VS Code: Symbol suchen",
  },
  {
    id: "query.run",
    routeScope: "query",
    label: "Abfrage ausführen",
    description: "Führt das Editor-SQL aus, F5 nur im Query-Kontext",
    area: "SQL-Editor",
    defaultHotkey: "Mod+Enter",
    aliases: ["F5"],
    requiresConnection: true,
    origin: "l8db",
    reference: "SSMS/DataGrip: F5 Ausführen",
  },
  {
    id: "query.runSelection",
    routeScope: "query",
    label: "Markierung ausführen",
    description: "Nur den selektierten SQL-Bereich ausführen",
    area: "SQL-Editor",
    defaultHotkey: "Mod+Shift+Enter",
    aliases: ["F9"],
    requiresConnection: true,
    origin: "l8db",
  },
  {
    id: "query.runStatement",
    routeScope: "query",
    label: "Anweisung unter dem Cursor ausführen",
    description: "Statement an der Cursorposition ausführen",
    area: "SQL-Editor",
    defaultHotkey: "Mod+Alt+Enter",
    requiresConnection: true,
    origin: "l8db",
  },
  {
    id: "query.save",
    routeScope: "query",
    label: "Abfrage speichern",
    description: "Speichert den Editor-Inhalt",
    area: "SQL-Editor",
    defaultHotkey: "Mod+S",
    origin: "VS Code",
    reference: "VS Code: Strg+S",
  },
  {
    id: "query.saveAs",
    routeScope: "query",
    label: "Abfrage speichern unter",
    description: "Speichern-unter-Dialog für SQL-Dateien",
    area: "SQL-Editor",
    defaultHotkey: "Mod+Shift+S",
    origin: "VS Code",
    reference: "VS Code: Strg+Umschalt+S",
  },
  {
    id: "query.format",
    routeScope: "query",
    label: "SQL formatieren",
    description: "Formatiert das Editor-SQL",
    area: "SQL-Editor",
    defaultHotkey: "Alt+Shift+F",
    origin: "VS Code",
    reference: "VS Code: Umschalt+Alt+F",
  },
  {
    id: "query.openFile",
    label: "SQL-Datei öffnen",
    description: "Datei als neuen Query-Tab laden",
    area: "SQL-Editor",
    defaultHotkey: "Mod+O",
    origin: "VS Code",
    reference: "VS Code/Chrome: Strg+O Öffnen",
  },
  {
    id: "query.comment",
    routeScope: "query",
    label: "Zeile kommentieren",
    description: "Kommentar für Auswahl oder Zeile umschalten",
    area: "SQL-Editor",
    defaultHotkey: "Mod+/",
    origin: "VS Code",
    reference: "VS Code: Strg+/",
  },
  {
    id: "query.bookmark",
    routeScope: "query",
    label: "Lesezeichen umschalten",
    description: "Bookmark an der Cursorzeile setzen oder entfernen",
    area: "SQL-Editor",
    defaultHotkey: "Mod+Alt+B",
    origin: "l8db",
  },
  {
    id: "query.nextBookmark",
    routeScope: "query",
    label: "Nächstes Lesezeichen",
    description: "Springt zum nächsten Bookmark",
    area: "SQL-Editor",
    defaultHotkey: "F2",
    origin: "VS Code",
    reference: "VS Code: F2/F8 Navigation",
  },
  {
    id: "query.prevBookmark",
    routeScope: "query",
    label: "Vorheriges Lesezeichen",
    description: "Springt zum vorherigen Bookmark",
    area: "SQL-Editor",
    defaultHotkey: "Shift+F2",
    origin: "VS Code",
  },
  {
    id: "query.history",
    routeScope: "query",
    label: "Abfrageverlauf öffnen",
    description: "Zuletzt ausgeführte Statements",
    area: "SQL-Editor",
    defaultHotkey: "Mod+H",
    origin: "l8db",
  },
  {
    id: "grid.search",
    routeScope: "data",
    label: "In Ergebnissen suchen",
    description: "Volltextsuche im Datengitter",
    area: "Datengitter",
    defaultHotkey: "Mod+F",
    requiresConnection: true,
    origin: "VS Code",
    reference: "VS Code/Chrome: Strg+F",
  },
  {
    id: "grid.copy",
    routeScope: "data",
    label: "Auswahl kopieren",
    description: "Selektierte Zellen in die Zwischenablage",
    area: "Datengitter",
    defaultHotkey: "Mod+C",
    requiresConnection: true,
    origin: "l8db",
  },
  {
    id: "grid.export",
    routeScope: "data",
    label: "Ergebnisse exportieren",
    description: "Exportdialog für das aktuelle Ergebnis",
    area: "Datengitter",
    defaultHotkey: "Mod+E",
    requiresConnection: true,
    origin: "l8db",
  },
  {
    id: "grid.nextPage",
    routeScope: "data",
    label: "Nächste Seite",
    description: "Blättert im Datengitter weiter",
    area: "Datengitter",
    defaultHotkey: "Alt+ArrowDown",
    requiresConnection: true,
    origin: "l8db",
  },
  {
    id: "grid.prevPage",
    routeScope: "data",
    label: "Vorherige Seite",
    description: "Blättert im Datengitter zurück",
    area: "Datengitter",
    defaultHotkey: "Alt+ArrowUp",
    requiresConnection: true,
    origin: "l8db",
  },
  {
    id: "settings.search",
    label: "Einstellungen durchsuchen",
    description: "Fokussiert die Einstellungssuche",
    area: "Allgemein",
    defaultHotkey: "Mod+Shift+F",
    origin: "l8db",
  },
];

export const HOTKEY_COMMAND_IDS = HOTKEY_COMMANDS.map((command) => command.id);

export function commandById(id: string): HotkeyCommand | undefined {
  return HOTKEY_COMMANDS.find((command) => command.id === id);
}

export function defaultHotkeyFor(id: string): Hotkey {
  return commandById(id)?.defaultHotkey ?? ("Escape" as Hotkey);
}

interface HotkeysState {
  overrides: Record<string, string>;
  setOverride: (id: string, hotkey: string | null) => void;
  resetAll: () => void;
}

export const useHotkeysStore = create<HotkeysState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (id, hotkey) =>
        set((state) => {
          if (hotkey === null) {
            if (!(id in state.overrides)) return state;
            const next = { ...state.overrides };
            delete next[id];
            return { overrides: next };
          }
          if (state.overrides[id] === hotkey) return state;
          return { overrides: { ...state.overrides, [id]: hotkey } };
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: "l8db.hotkeys", version: 1 },
  ),
);

export function resolveHotkey(id: string, overrides?: Record<string, string>): Hotkey {
  const command = commandById(id);
  const fallback = command?.defaultHotkey ?? ("Escape" as Hotkey);
  const raw = overrides?.[id] ?? useHotkeysStore.getState().overrides[id] ?? fallback;
  return raw as Hotkey;
}

export function useResolvedHotkey(id: string): Hotkey {
  const override = useHotkeysStore((state) => state.overrides[id]);
  return useMemo(() => {
    const command = commandById(id);
    return ((override ?? command?.defaultHotkey ?? "Escape") as Hotkey) ?? ("Escape" as Hotkey);
  }, [id, override]);
}

export function useAllResolvedHotkeys(): Record<string, Hotkey> {
  const overrides = useHotkeysStore((state) => state.overrides);
  return useMemo(() => {
    const resolved: Record<string, Hotkey> = {};
    for (const command of HOTKEY_COMMANDS) {
      resolved[command.id] = (overrides[command.id] ?? command.defaultHotkey) as Hotkey;
    }
    return resolved;
  }, [overrides]);
}

export function canonicalizeHotkey(value: string): string {
  return value
    .split("+")
    .map((part) => {
      const token = part.trim().toLowerCase();
      if (token === "mod" || token === "cmd" || token === "command" || token === "meta")
        return "mod";
      if (token === "ctrl" || token === "control") return "ctrl";
      if (token === "option") return "alt";
      if (token === "esc") return "escape";
      if (token === "spacebar" || token === "space bar") return "space";
      if (token === "left" || token === "arrowleft") return "arrowleft";
      if (token === "right" || token === "arrowright") return "arrowright";
      if (token === "up" || token === "arrowup") return "arrowup";
      if (token === "down" || token === "arrowdown") return "arrowdown";
      if (token === "del") return "delete";
      if (token === "pos1") return "home";
      return token;
    })
    .sort()
    .join("+");
}

export interface HotkeyConflict {
  hotkey: string;
  ids: string[];
}

const ALLOWED_OVERLAPS: string[][] = [["app.refresh", "query.run"]];

function isAllowedOverlap(ids: string[]): boolean {
  const primary = [...new Set(ids.map((id) => id.split("::")[0]))];
  return ALLOWED_OVERLAPS.some((group) => primary.every((id) => group.includes(id)));
}

export function detectHotkeyConflicts(resolved?: Record<string, string>): HotkeyConflict[] {
  const store = resolved ?? useHotkeysStore.getState().overrides;
  const full: Record<string, string> = {};
  for (const command of HOTKEY_COMMANDS) {
    full[command.id] = store[command.id] ?? command.defaultHotkey;
    for (const alias of command.aliases ?? []) {
      full[`${command.id}::${alias}`] = alias;
    }
  }
  const byKey = new Map<string, string[]>();
  for (const [id, hotkey] of Object.entries(full)) {
    const key = canonicalizeHotkey(hotkey);
    const list = byKey.get(key) ?? [];
    list.push(id);
    byKey.set(key, list);
  }
  const conflicts: HotkeyConflict[] = [];
  for (const [key, ids] of byKey) {
    const primary = ids.filter((id) => !id.includes("::"));
    const aliasOwners = new Set(ids.map((id) => id.split("::")[0]));
    if (primary.length > 1 || (primary.length === 1 && aliasOwners.size > 1)) {
      if (!isAllowedOverlap(ids)) conflicts.push({ hotkey: key, ids: [...new Set(ids)] });
    }
  }
  return conflicts;
}

export function findHotkeyConflict(
  hotkey: string,
  ignoreId?: string,
  resolved?: Record<string, string>,
): string[] {
  const store = resolved ?? useHotkeysStore.getState().overrides;
  const wanted = canonicalizeHotkey(hotkey);
  const hits: string[] = [];
  for (const command of HOTKEY_COMMANDS) {
    if (command.id === ignoreId) continue;
    const candidates = [store[command.id] ?? command.defaultHotkey, ...(command.aliases ?? [])];
    if (candidates.some((candidate) => canonicalizeHotkey(candidate) === wanted)) {
      if (ignoreId && isAllowedOverlap([ignoreId, command.id])) continue;
      hits.push(command.id);
    }
  }
  return hits;
}

export function validateHotkeyInput(value: string): { valid: boolean; errors: string[] } {
  const trimmed = value.trim();
  if (!trimmed) return { valid: false, errors: ["Leerer Hotkey"] };
  const result = validateHotkey(trimmed as Hotkey);
  return { valid: result.valid, errors: result.errors };
}

export function detectHotkeyPlatform(): "mac" | "windows" | "linux" {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform ?? "";
  const userAgent = navigator.userAgent ?? "";
  if (/Mac|iPhone|iPad|iPod/i.test(platform)) return "mac";
  if (/Win/i.test(platform)) return "windows";
  if (/Linux/i.test(userAgent) || /Linux/i.test(platform)) return "linux";
  return "windows";
}

export function formatHotkeyDisplay(hotkey: string): string {
  try {
    return formatForDisplay(hotkey as Hotkey, { platform: detectHotkeyPlatform() });
  } catch {
    return hotkey;
  }
}

export function splitHotkeyForKbd(hotkey: string): string[] {
  const display = formatHotkeyDisplay(hotkey);
  if (display.includes("+")) return display.split("+").map((part) => part.trim());
  return display
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean);
}

export const HOTKEY_ACTION_EVENT = "l8db:hotkey";

export function emitHotkeyAction(id: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(HOTKEY_ACTION_EVENT, { detail: id }));
}

export function onHotkeyAction(id: string, handler: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === id) handler();
  };
  window.addEventListener(HOTKEY_ACTION_EVENT, listener);
  return () => window.removeEventListener(HOTKEY_ACTION_EVENT, listener);
}

export function isHotkeyAvailable(id: string, context: { hasConnection: boolean }): boolean {
  const command = commandById(id);
  if (!command) return false;
  if (command.requiresConnection) return context.hasConnection;
  return true;
}

export function isCommandVisibleInRoute(command: HotkeyCommand, pathname: string): boolean {
  if (command.routeScope === "query") return pathname.startsWith("/query");
  if (command.routeScope === "data") {
    return pathname.startsWith("/query") || pathname.includes("/tables/");
  }
  return true;
}

export function filterHotkeyCommands(query: string): HotkeyCommand[] {
  const term = query.trim().toLowerCase();
  if (!term) return HOTKEY_COMMANDS;
  const terms = term.split(/\s+/);
  return HOTKEY_COMMANDS.filter((command) => {
    const resolved = resolveHotkey(command.id);
    const haystack = [
      command.label,
      command.description,
      command.area,
      command.id,
      command.reference ?? "",
      resolved,
      formatHotkeyDisplay(resolved),
    ]
      .join(" ")
      .toLowerCase();
    return terms.every((part) => haystack.includes(part));
  });
}

export function groupHotkeyCommands(
  commands: HotkeyCommand[],
): { area: HotkeyArea; commands: HotkeyCommand[] }[] {
  return HOTKEY_AREAS.map((area) => ({
    area,
    commands: commands.filter((command) => command.area === area),
  })).filter((group) => group.commands.length > 0);
}
