import { create } from "zustand";
import type { Dataset, Widget } from "./model";

export interface ChartTab {
  id: string;
  dashboardId: string;
  widget: Widget;
  dataset: Dataset;
  isNew: boolean;
  dirty: boolean;
}

interface ChartTabsState {
  tabs: ChartTab[];
  active: Record<string, string | null>;
  open: (tab: Omit<ChartTab, "id" | "dirty">) => void;
  change: (id: string, draft: Pick<ChartTab, "widget" | "dataset">) => void;
  saved: (id: string, draft: Pick<ChartTab, "widget" | "dataset">) => void;
  close: (id: string) => void;
  focus: (dashboardId: string, id: string | null) => void;
}

export const useChartTabsStore = create<ChartTabsState>()((set) => ({
  tabs: [],
  active: {},
  open: (tab) =>
    set((state) => {
      const existing = tab.isNew
        ? undefined
        : state.tabs.find(
            (t) => t.dashboardId === tab.dashboardId && t.widget.id === tab.widget.id,
          );
      if (existing) return { active: { ...state.active, [tab.dashboardId]: existing.id } };
      const id = `${tab.dashboardId}:${tab.widget.id}`;
      return {
        tabs: [...state.tabs, { ...tab, id, dirty: tab.isNew }],
        active: { ...state.active, [tab.dashboardId]: id },
      };
    }),
  change: (id, draft) =>
    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? { ...t, ...draft, dirty: true } : t)),
    })),
  saved: (id, draft) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, ...draft, isNew: false, dirty: false } : t,
      ),
    })),
  close: (id) =>
    set((state) => {
      const tab = state.tabs.find((t) => t.id === id);
      if (!tab) return state;
      const tabs = state.tabs.filter((t) => t.id !== id);
      const active =
        state.active[tab.dashboardId] === id
          ? { ...state.active, [tab.dashboardId]: null }
          : state.active;
      return { tabs, active };
    }),
  focus: (dashboardId, id) => set((state) => ({ active: { ...state.active, [dashboardId]: id } })),
}));
