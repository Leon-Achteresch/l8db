import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import type { ChartFile } from "@/lib/chart-file";
import { createId } from "@/lib/dashboards";
import { syncAcrossWindows } from "@/lib/window-sync";

export type DashboardDrawerKind = "dashboards" | "charts";
export const DRAWER_MIN_WIDTH = 280;
export const DRAWER_MAX_WIDTH = 860;
export function clampDrawerWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, Math.round(width)))
    : 380;
}
export const SOURCE_LIST_MIN_WIDTH = 200;
export const SOURCE_LIST_MAX_WIDTH = 640;
export function clampSourceListWidth(width: number): number {
  return Number.isFinite(width)
    ? Math.max(SOURCE_LIST_MIN_WIDTH, Math.min(SOURCE_LIST_MAX_WIDTH, Math.round(width)))
    : 240;
}
export interface SavedChart extends ChartFile {
  id: string;
  savedAt: number;
}
interface DashboardWorkspaceState {
  drawerWidths: Record<DashboardDrawerKind, number>;
  sourceListWidth: number;
  savedCharts: SavedChart[];
  databaseSharing: boolean;
  setDatabaseSharing: (enabled: boolean) => void;
  setDrawerWidth: (drawer: DashboardDrawerKind, width: number) => void;
  setSourceListWidth: (width: number) => void;
  saveChart: (chart: ChartFile) => string;
  removeChart: (id: string) => void;
}
export const useDashboardWorkspaceStore = create<DashboardWorkspaceState>()(
  persist(
    (set) => ({
      drawerWidths: { dashboards: 380, charts: 400 },
      sourceListWidth: 240,
      savedCharts: [],
      databaseSharing: false,
      setDatabaseSharing: (databaseSharing) => set({ databaseSharing }),
      setDrawerWidth: (drawer, width) =>
        set((state) => ({
          drawerWidths: { ...state.drawerWidths, [drawer]: clampDrawerWidth(width) },
        })),
      setSourceListWidth: (width) => set({ sourceListWidth: clampSourceListWidth(width) }),
      saveChart: (chart) => {
        const id = createId();
        set((state) => ({
          savedCharts: [
            { ...structuredClone(chart), id, savedAt: Date.now() },
            ...state.savedCharts,
          ],
        }));
        return id;
      },
      removeChart: (id) =>
        set((state) => ({ savedCharts: state.savedCharts.filter((chart) => chart.id !== id) })),
    }),
    {
      name: "l8db.dashboard-workspace",
      storage: createBufferedJsonStorage(() => window.localStorage),
    },
  ),
);

syncAcrossWindows(
  "l8db.dashboard-workspace",
  () => void useDashboardWorkspaceStore.persist.rehydrate(),
);
