import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type DashboardPaletteMode = "connection" | "vivid";

export const useDashboardPalette = create<{
  mode: DashboardPaletteMode;
  setMode: (mode: DashboardPaletteMode) => void;
}>()(
  persist((set) => ({ mode: "connection", setMode: (mode) => set({ mode }) }), {
    name: "l8db.dashboard-palette",
  }),
);

syncAcrossWindows("l8db.dashboard-palette", () => void useDashboardPalette.persist.rehydrate());

const VIVID_STYLE = { "--dash-accent": "var(--dash-color-1)" };

export function paletteStyle(mode: DashboardPaletteMode): Record<string, string> | undefined {
  return mode === "vivid" ? VIVID_STYLE : undefined;
}
