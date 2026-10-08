import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";
import { VIVID_PALETTE } from "./model";

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

export function paletteStyle(mode: DashboardPaletteMode): Record<string, string> | undefined {
  if (mode !== "vivid") return undefined;
  return Object.fromEntries(
    VIVID_PALETTE.map((color, index) => [`--dash-color-${index + 1}`, color]),
  );
}
