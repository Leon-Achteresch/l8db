import { useMemo } from "react";
import { favoritesFor, useObjectFavoritesStore } from "@/lib/object-favorites";
import { useTableTabs } from "@/lib/table-tabs";
import { atlasKey } from "./atlas-layout";
import type { AtlasMark } from "./atlas-tile";

export const TRAIL_LIMIT = 8;

export interface TrailEntry {
  key: string;
  schema: string;
  name: string;
  view: boolean;
  state: "favorite" | "open" | "closed";
  at: number | null;
}

export function useAtlasTrail(connectionId: string, database: string | null) {
  const tabs = useTableTabs((state) => state.tabs);
  const closed = useTableTabs((state) => state.recentlyClosed);
  const favorites = useObjectFavoritesStore((state) => state.favorites);
  return useMemo(() => {
    const entries = new Map<string, TrailEntry>();
    const add = (entry: Omit<TrailEntry, "key">) => {
      const key = atlasKey(entry.schema, entry.name);
      if (!entries.has(key)) entries.set(key, { ...entry, key });
    };
    for (const favorite of favoritesFor(favorites, connectionId, database))
      if (favorite.type !== "matview")
        add({
          schema: favorite.schema,
          name: favorite.name,
          view: favorite.type === "view",
          state: "favorite",
          at: null,
        });
    for (const tab of tabs)
      if (tab.kind === "table")
        add({
          schema: tab.schema,
          name: tab.table,
          view: tab.entityType === "view",
          state: "open",
          at: null,
        });
    for (const tab of closed)
      if (
        tab.kind === "table" &&
        tab.closedConnectionId === connectionId &&
        (tab.closedDatabase ?? null) === database
      )
        add({
          schema: tab.schema,
          name: tab.table,
          view: tab.entityType === "view",
          state: "closed",
          at: tab.closedAt ?? null,
        });
    const list = [...entries.values()];
    const marks = new Map<string, AtlasMark>();
    for (const entry of list)
      if (entry.state !== "closed")
        marks.set(entry.key, entry.state === "favorite" ? "favorite" : "open");
    return { entries: list.slice(0, TRAIL_LIMIT), marks };
  }, [tabs, closed, favorites, connectionId, database]);
}
