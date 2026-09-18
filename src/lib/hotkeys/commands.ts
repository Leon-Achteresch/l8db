import type { Hotkey } from "@tanstack/react-hotkeys";
import { GENERAL_COMMANDS } from "./commands-general";
import { GRID_COMMANDS } from "./commands-grid";
import { NAVIGATION_COMMANDS } from "./commands-navigation";
import { SQL_EDITOR_COMMANDS } from "./commands-sql-editor";
import { TAB_COMMANDS } from "./commands-tabs";
import type { HotkeyCommand } from "./types";

export const HOTKEY_COMMANDS: HotkeyCommand[] = [
  ...GENERAL_COMMANDS,
  ...TAB_COMMANDS,
  ...NAVIGATION_COMMANDS,
  ...SQL_EDITOR_COMMANDS,
  ...GRID_COMMANDS,
];

export const HOTKEY_COMMAND_IDS = HOTKEY_COMMANDS.map((command) => command.id);

export function commandById(id: string): HotkeyCommand | undefined {
  return HOTKEY_COMMANDS.find((command) => command.id === id);
}

export function defaultHotkeyFor(id: string): Hotkey {
  return commandById(id)?.defaultHotkey ?? ("Escape" as Hotkey);
}
