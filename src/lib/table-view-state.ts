import type { ColumnSizingState, SortingState } from "@tanstack/react-table";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import type { TableDetailTab } from "@/lib/table-detail-tabs";

export interface FilterCondition {
  id: string;
  column: string;
  operator: string;
  value: string;
  dataType?: string;
}

export interface TableViewState {
  filter: string;
  filterRaw: boolean;
  sorting: SortingState;
  page: number;
  detailTab: TableDetailTab;
  filterOpen: boolean;
  filterMode: "simple" | "sql";
  filterConditions: FilterCondition[];
  filterCombinator: "AND" | "OR";
  filterSql: string;
  columnSizing: ColumnSizingState;
  scroll: { top: number; left: number; identity: string };
}

export function tableViewStateKey(
  connectionId: string | undefined,
  database: string | null,
  schema: string,
  table: string,
): string | undefined {
  return connectionId ? JSON.stringify([connectionId, database, schema, table]) : undefined;
}

interface TableViewStateStore {
  views: Record<string, Partial<TableViewState>>;
  patch: (key: string, patch: Partial<TableViewState>) => void;
}

export const useTableViewStateStore = create<TableViewStateStore>()(
  persist(
    (set) => ({
      views: {},
      patch: (key, patch) =>
        set((state) => {
          const views = { ...state.views };
          const previous = views[key];
          delete views[key];
          views[key] = { ...previous, ...patch };
          const keys = Object.keys(views);
          for (const oldest of keys.slice(0, Math.max(0, keys.length - 100))) {
            delete views[oldest];
          }
          return { views };
        }),
    }),
    {
      name: "l8db.table-view-state",
      storage: createBufferedJsonStorage(() => window.localStorage),
      partialize: (state) => ({ views: state.views }),
    },
  ),
);
