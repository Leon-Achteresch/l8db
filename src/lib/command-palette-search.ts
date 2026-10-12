import type { CommandItem } from "@/components/motion/command-palette/types";
import type { PaletteHistory } from "@/lib/palette-history";

const HISTORY_SIZE = 5;

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

export function withHistory(items: CommandItem[], history: PaletteHistory, query: string) {
  if (query.trim()) return items;
  const used = items.filter((item) => history[item.id]);
  if (used.length === 0) return items;
  const recent = [...used]
    .sort((a, b) => history[b.id].last - history[a.id].last)
    .slice(0, HISTORY_SIZE);
  const recentIds = new Set(recent.map((item) => item.id));
  const frequent = used
    .filter((item) => !recentIds.has(item.id) && history[item.id].count > 1)
    .sort(
      (a, b) =>
        history[b.id].count - history[a.id].count || history[b.id].last - history[a.id].last,
    )
    .slice(0, HISTORY_SIZE);
  const pinned = [
    ...recent.map((item) => ({ ...item, group: "Zuletzt" })),
    ...frequent.map((item) => ({ ...item, group: "Häufig" })),
  ];
  const ids = new Set(pinned.map((item) => item.id));
  return [...pinned, ...items.filter((item) => !ids.has(item.id))];
}
