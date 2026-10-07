import type { CommandItem } from "@/components/motion/command-palette/types";

export function parsePaletteQuery(query: string, commandsEnabled = true) {
  const commandsOnly = commandsEnabled && query.trimStart().startsWith(">");
  return {
    commandsOnly,
    search: commandsOnly ? query.trimStart().slice(1).trimStart() : query,
  };
}

export function paletteSearchItems(items: CommandItem[], commandsOnly: boolean) {
  return commandsOnly
    ? items.filter((item) => item.kind === "command" || item.kind === "setting")
    : items;
}

export function withRecentCommands(items: CommandItem[], recentIds: string[], query: string) {
  if (query.trim() || recentIds.length === 0) return items;
  const recent = recentIds.flatMap((id) => {
    const item = items.find((entry) => entry.id === id && entry.kind === "command");
    return item ? [{ ...item, group: "Zuletzt verwendet" }] : [];
  });
  const ids = new Set(recent.map((item) => item.id));
  return [...recent, ...items.filter((item) => !ids.has(item.id))];
}
