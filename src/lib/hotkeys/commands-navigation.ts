import type { HotkeyCommand } from "./types";

export const NAVIGATION_COMMANDS: HotkeyCommand[] = [
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
];
