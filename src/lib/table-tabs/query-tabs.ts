import type { QueryTab, Tab } from "./types";

export function isQueryTabDirty(tab: QueryTab): boolean {
  return tab.filePath !== undefined && tab.sql !== (tab.savedSql ?? "");
}

export function queryNeedsCloseConfirmation(tab: QueryTab): boolean {
  return isQueryTabDirty(tab) || (!tab.filePath && tab.sql.trim().length > 0);
}

export function hasUnexecutedQueryChanges(tab: QueryTab): boolean {
  return (
    tab.sql.trim().length > 0 &&
    tab.lastExecutedSql !== undefined &&
    tab.sql !== tab.lastExecutedSql
  );
}
export function normalizeBookmarks(lines: number[]): number[] {
  return [...new Set(lines.filter((line) => Number.isInteger(line) && line > 0))].sort(
    (a, b) => a - b,
  );
}

export function queryTabBookmarks(tab: QueryTab): number[] {
  return normalizeBookmarks(tab.bookmarks ?? []);
}

export type BookmarkSlots = Record<string, number>;

export function normalizeBookmarkSlots(slots: BookmarkSlots | undefined): BookmarkSlots {
  if (!slots) return {};
  const next: BookmarkSlots = {};
  for (const [key, line] of Object.entries(slots)) {
    const slot = Number(key);
    if (Number.isInteger(slot) && slot >= 1 && slot <= 9 && Number.isInteger(line) && line > 0) {
      next[String(slot)] = line;
    }
  }
  return next;
}

export function queryTabBookmarkSlots(tab: QueryTab): BookmarkSlots {
  return normalizeBookmarkSlots(tab.bookmarkSlots);
}

export function pruneBookmarkSlots(slots: BookmarkSlots, lines: number[]): BookmarkSlots {
  return Object.fromEntries(Object.entries(slots).filter(([, line]) => lines.includes(line)));
}

export function patchQueryTab(tabs: Tab[], id: string, patch: Partial<QueryTab>): Tab[] {
  return tabs.map((t) => (t.kind === "query" && t.id === id ? { ...t, ...patch } : t));
}
