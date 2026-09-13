import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TableColumnPref } from "@/lib/table-column-prefs";
import type { TableViewState } from "@/lib/table-view-state";

export interface SavedView {
  id: string;
  name: string;
  filter: string;
  color: string;
  filterRaw?: boolean;
  state?: Partial<TableViewState>;
  layout?: TableColumnPref;
}

export function savedViewKey(
  connectionId: string,
  database: string | null,
  schema: string,
  table: string,
): string {
  return JSON.stringify([connectionId, database, schema, table]);
}

export const VIEW_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#a855f7",
  "#ec4899",
  "#eab308",
  "#ef4444",
];

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

interface ViewsState {
  views: Record<string, SavedView[]>;
  addView: (tableKey: string, view: Omit<SavedView, "id">) => void;
  removeView: (tableKey: string, id: string) => void;
  renameView: (tableKey: string, id: string, name: string) => void;
}

export const useViewsStore = create<ViewsState>()(
  persist(
    (set) => ({
      views: {},
      addView: (tableKey, view) =>
        set((state) => ({
          views: {
            ...state.views,
            [tableKey]: [...(state.views[tableKey] ?? []), { id: createId(), ...view }],
          },
        })),
      removeView: (tableKey, id) =>
        set((state) => ({
          views: {
            ...state.views,
            [tableKey]: (state.views[tableKey] ?? []).filter((v) => v.id !== id),
          },
        })),
      renameView: (tableKey, id, name) =>
        set((state) => ({
          views: {
            ...state.views,
            [tableKey]: (state.views[tableKey] ?? []).map((v) =>
              v.id === id ? { ...v, name } : v,
            ),
          },
        })),
    }),
    {
      name: "l8db.views",
    },
  ),
);
