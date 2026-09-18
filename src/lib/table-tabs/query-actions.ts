import { storeFor } from "./helpers";
import {
  normalizeBookmarks,
  patchQueryTab,
  pruneBookmarkSlots,
  queryTabBookmarkSlots,
  queryTabBookmarks,
} from "./query-tabs";
import type { QueryTab, TabsGet, TabsSet, TabsState } from "./types";

export function createQueryActions(
  set: TabsSet,
  get: TabsGet,
): Pick<
  TabsState,
  | "updateQuerySql"
  | "markQueryTabExecuted"
  | "openFileQueryTab"
  | "bindQueryTabFile"
  | "markQueryTabSaved"
  | "setQueryTabExternalChange"
  | "reloadQueryTabFromFile"
  | "toggleQueryBookmark"
  | "setQueryBookmarks"
  | "setQueryBookmarkSlot"
  | "clearQueryBookmarks"
> {
  return {
    updateQuerySql: (id, sql) =>
      set((state) => {
        const tab = state.tabs.find((entry) => entry.kind === "query" && entry.id === id);
        const patch =
          tab?.kind === "query" && tab.lastExecutedSql === undefined
            ? { sql, lastExecutedSql: tab.sql }
            : { sql };
        return storeFor(patchQueryTab(state.tabs, id, patch), state);
      }),

    markQueryTabExecuted: (id, sql) =>
      set((state) => storeFor(patchQueryTab(state.tabs, id, { lastExecutedSql: sql }), state)),

    openFileQueryTab: (file) => {
      const existing = get().tabs.find((t) => t.kind === "query" && t.filePath === file.path);
      if (existing && existing.kind === "query") return existing.id;
      const qt: QueryTab = {
        kind: "query",
        id: crypto.randomUUID(),
        title: file.title,
        sql: file.sql,
        filePath: file.path,
        savedSql: file.sql,
        fileMtime: file.mtime,
        externalChange: false,
      };
      set((state) => storeFor([...state.tabs, qt], state));
      return qt.id;
    },

    bindQueryTabFile: (id, file) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
        if (!tab || tab.kind !== "query") return state;
        return storeFor(
          patchQueryTab(state.tabs, id, {
            filePath: file.path,
            title: file.title,
            savedSql: file.savedSql ?? tab.sql,
            fileMtime: file.mtime,
            externalChange: false,
          }),
          state,
        );
      }),

    markQueryTabSaved: (id, mtime, savedSql) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
        if (!tab || tab.kind !== "query") return state;
        return storeFor(
          patchQueryTab(state.tabs, id, {
            savedSql: savedSql ?? tab.sql,
            fileMtime: mtime,
            externalChange: false,
          }),
          state,
        );
      }),

    setQueryTabExternalChange: (id, changed, mtime) =>
      set((state) =>
        storeFor(
          patchQueryTab(state.tabs, id, {
            externalChange: changed,
            ...(mtime === undefined ? {} : { fileMtime: mtime }),
          }),
          state,
        ),
      ),

    reloadQueryTabFromFile: (id, sql, mtime) =>
      set((state) =>
        storeFor(
          patchQueryTab(state.tabs, id, {
            sql,
            savedSql: sql,
            fileMtime: mtime,
            externalChange: false,
          }),
          state,
        ),
      ),

    toggleQueryBookmark: (id, line) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
        if (!tab || tab.kind !== "query") return state;
        const current = queryTabBookmarks(tab);
        const next = current.includes(line)
          ? current.filter((entry) => entry !== line)
          : normalizeBookmarks([...current, line]);
        const patch: Partial<QueryTab> = { bookmarks: next };
        if (!next.includes(line)) {
          const slots = queryTabBookmarkSlots(tab);
          const pruned = pruneBookmarkSlots(slots, next);
          if (Object.keys(pruned).length !== Object.keys(slots).length) {
            patch.bookmarkSlots = pruned;
          }
        }
        return storeFor(patchQueryTab(state.tabs, id, patch), state);
      }),

    setQueryBookmarks: (id, lines) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
        if (!tab || tab.kind !== "query") return state;
        const next = normalizeBookmarks(lines);
        const current = queryTabBookmarks(tab);
        const slots = queryTabBookmarkSlots(tab);
        const pruned = pruneBookmarkSlots(slots, next);
        const slotsChanged = Object.keys(pruned).length !== Object.keys(slots).length;
        if (
          !slotsChanged &&
          next.length === current.length &&
          next.every((line, i) => line === current[i])
        ) {
          return state;
        }
        return storeFor(
          patchQueryTab(state.tabs, id, {
            bookmarks: next,
            ...(slotsChanged ? { bookmarkSlots: pruned } : {}),
          }),
          state,
        );
      }),

    setQueryBookmarkSlot: (id, slot, line) =>
      set((state) => {
        const tab = state.tabs.find((t) => t.kind === "query" && t.id === id);
        if (!tab || tab.kind !== "query") return state;
        if (!Number.isInteger(slot) || slot < 1 || slot > 9) return state;
        const key = String(slot);
        const slots = queryTabBookmarkSlots(tab);
        if (line === null) {
          if (!(key in slots)) return state;
          const { [key]: removedLine, ...rest } = slots;
          if (Object.values(rest).includes(removedLine)) {
            return storeFor(patchQueryTab(state.tabs, id, { bookmarkSlots: rest }), state);
          }
          return storeFor(
            patchQueryTab(state.tabs, id, {
              bookmarkSlots: rest,
              bookmarks: queryTabBookmarks(tab).filter((entry) => entry !== removedLine),
            }),
            state,
          );
        }
        if (!Number.isInteger(line) || line <= 0) return state;
        if (slots[key] === line) return state;
        return storeFor(
          patchQueryTab(state.tabs, id, {
            bookmarkSlots: { ...slots, [key]: line },
            bookmarks: normalizeBookmarks([...queryTabBookmarks(tab), line]),
          }),
          state,
        );
      }),

    clearQueryBookmarks: (id) =>
      set((state) =>
        storeFor(patchQueryTab(state.tabs, id, { bookmarks: [], bookmarkSlots: {} }), state),
      ),
  };
}
