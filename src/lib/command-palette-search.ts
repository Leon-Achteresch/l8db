import type { CommandItem } from "@/components/motion/command-palette/types";
import type { PaletteHistory } from "@/lib/palette-history";

const HISTORY_SIZE = 5;

export const UNUSED_PREFIX = "neu:";

export function parsePaletteQuery(query: string, commandsEnabled = true, unusedEnabled = false) {
  const trimmed = query.trimStart();
  const commandsOnly = commandsEnabled && trimmed.startsWith(">");
  const unusedOnly =
    !commandsOnly && unusedEnabled && trimmed.toLowerCase().startsWith(UNUSED_PREFIX);
  return {
    commandsOnly,
    unusedOnly,
    search: commandsOnly
      ? trimmed.slice(1).trimStart()
      : unusedOnly
        ? trimmed.slice(UNUSED_PREFIX.length).trimStart()
        : query,
  };
}

export function withQueryItems(items: CommandItem[], extra: CommandItem[]): CommandItem[] {
  if (extra.length === 0) return items;
  const ids = new Set(items.map((item) => item.id));
  return [...items, ...extra.filter((item) => !ids.has(item.id))];
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

export function withoutChildren(items: CommandItem[], query: string) {
  return query.trim() ? items : items.filter((item) => !item.parentId);
}

export function nestUnderParents(ranked: CommandItem[], byId: ReadonlyMap<string, CommandItem>) {
  if (!ranked.some((item) => item.parentId)) return ranked;
  const children = new Map<string, CommandItem[]>();
  for (const item of ranked) {
    if (!item.parentId) continue;
    const list = children.get(item.parentId) ?? [];
    list.push(item);
    children.set(item.parentId, list);
  }
  const placed = new Set<string>();
  const result: CommandItem[] = [];
  for (const item of ranked) {
    const parent = item.parentId ? byId.get(item.parentId) : item;
    if (!parent) {
      result.push({ ...item, parentId: undefined });
      continue;
    }
    if (placed.has(parent.id)) continue;
    placed.add(parent.id);
    result.push(parent);
    for (const child of children.get(parent.id) ?? [])
      result.push({ ...child, group: parent.group });
  }
  return result;
}
