import { commandById, HOTKEY_COMMANDS } from "./commands";
import { HOTKEY_AREAS } from "./constants";
import { formatHotkeyDisplay } from "./display";
import type { HotkeyArea, HotkeyCommand } from "./types";
import { resolveHotkey } from "./use-hotkeys-store";

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
