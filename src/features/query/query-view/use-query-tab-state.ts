import { useMemo } from "react";

import { isQueryTabDirty, normalizeBookmarks, useTableTabs } from "@/lib/table-tabs";

import { EMPTY_BOOKMARK_SLOTS, EMPTY_BOOKMARKS } from "./constants";

export function useQueryTabSql(tabId: string) {
  const sql = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? tab.sql : "";
  });
  const updateQuerySql = useTableTabs((state) => state.updateQuerySql);
  const markQueryTabExecuted = useTableTabs((state) => state.markQueryTabExecuted);
  const filePath = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? (tab.filePath ?? null) : null;
  });
  const fileDirty = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? isQueryTabDirty(tab) : false;
  });
  const externalChange = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? Boolean(tab.externalChange) : false;
  });
  return { sql, updateQuerySql, markQueryTabExecuted, filePath, fileDirty, externalChange };
}

export function useQueryTabBookmarks(tabId: string) {
  const bookmarks = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? (tab.bookmarks ?? EMPTY_BOOKMARKS) : EMPTY_BOOKMARKS;
  });
  const setQueryBookmarks = useTableTabs((state) => state.setQueryBookmarks);
  const setQueryBookmarkSlot = useTableTabs((state) => state.setQueryBookmarkSlot);
  const clearQueryBookmarks = useTableTabs((state) => state.clearQueryBookmarks);
  const normalizedBookmarks = useMemo(() => normalizeBookmarks(bookmarks), [bookmarks]);
  const bookmarkSlots = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query"
      ? (tab.bookmarkSlots ?? EMPTY_BOOKMARK_SLOTS)
      : EMPTY_BOOKMARK_SLOTS;
  });
  return {
    normalizedBookmarks,
    bookmarkSlots,
    setQueryBookmarks,
    setQueryBookmarkSlot,
    clearQueryBookmarks,
  };
}
