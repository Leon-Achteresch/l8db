import type { Hotkey } from "@tanstack/react-hotkeys";

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
