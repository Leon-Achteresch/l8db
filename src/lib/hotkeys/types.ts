import type { Hotkey } from "@tanstack/react-hotkeys";
import type { FeatureCapability } from "@/lib/discovery/types";

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
  capability?: Exclude<FeatureCapability, "import">;
  ignoreInputs?: boolean;
  origin: HotkeyOrigin;
  reference?: string;
  routeScope?: "query" | "data";
}
