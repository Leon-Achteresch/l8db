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

export interface RowRule {
  id: string;
  color: string;
  combinator: "AND" | "OR";
  conditions: FilterCondition[];
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
  rowRules: RowRule[];
  columnSizing: ColumnSizingState;
  contentColumnSizing: ColumnSizingState;
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

type ViewStates = Record<string, Partial<TableViewState>>;

function patchViews(current: ViewStates, key: string, patch: Partial<TableViewState>): ViewStates {
  const views = { ...current };
  const previous = views[key];
  delete views[key];
  views[key] = { ...previous, ...patch };
  const keys = Object.keys(views);
  for (const oldest of keys.slice(0, Math.max(0, keys.length - 100))) {
    delete views[oldest];
  }
  return views;
}

export function detailTabFor(
  state: { views: ViewStates; lastDetailTab: TableDetailTab },
  key: string,
): TableDetailTab {
  return state.views[key]?.detailTab ?? state.lastDetailTab;
}

interface TableViewStateStore {
  views: ViewStates;
  lastDetailTab: TableDetailTab;
  patch: (key: string, patch: Partial<TableViewState>) => void;
  selectDetailTab: (key: string, tab: TableDetailTab) => void;
  keepDetailTab: (key: string) => void;
}

export const useTableViewStateStore = create<TableViewStateStore>()(
  persist(
    (set, get) => ({
      views: {},
      lastDetailTab: "data",
      patch: (key, patch) => set((state) => ({ views: patchViews(state.views, key, patch) })),
      selectDetailTab: (key, tab) =>
        set((state) => ({
          views: patchViews(state.views, key, { detailTab: tab }),
          lastDetailTab: tab,
        })),
      keepDetailTab: (key) => {
        const state = get();
        if (state.views[key]?.detailTab !== undefined) return;
        set({ views: patchViews(state.views, key, { detailTab: state.lastDetailTab }) });
      },
    }),
    {
      name: "l8db.table-view-state",
      storage: createBufferedJsonStorage(() => window.localStorage),
      partialize: (state) => ({ views: state.views, lastDetailTab: state.lastDetailTab }),
    },
  ),
);
