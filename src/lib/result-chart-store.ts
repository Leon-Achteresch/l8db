import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import type { ResultChartState } from "@/lib/result-chart";

const MAX_ENTRIES = 200;

export const EMPTY_RESULT_CHART: ResultChartState = { view: "grid", config: null };

interface ResultChartStore {
  charts: Record<string, ResultChartState>;
  set: (key: string, state: ResultChartState) => void;
  remove: (key: string) => void;
}

export const useResultChartStore = create<ResultChartStore>()(
  persist(
    (set) => ({
      charts: {},
      set: (key, state) =>
        set((s) => {
          const { [key]: _previous, ...rest } = s.charts;
          const entries = Object.entries({ ...rest, [key]: state });
          return { charts: Object.fromEntries(entries.slice(-MAX_ENTRIES)) };
        }),
      remove: (key) =>
        set((s) => {
          const { [key]: _removed, ...rest } = s.charts;
          return { charts: rest };
        }),
    }),
    {
      name: "l8db.result-charts",
      storage: createBufferedJsonStorage(() => window.localStorage),
    },
  ),
);
