import { create } from "zustand";
import { persist } from "zustand/middleware";

export const SIDEBAR_PANEL_MIN_WIDTH = 240;
export const SIDEBAR_PANEL_MAX_WIDTH = 512;
export const SIDEBAR_PANEL_DEFAULT_WIDTH = 304;

interface SidebarPanelState {
  width: number;
  dragWidth: number | null;
  isResizing: boolean;
  setWidth: (width: number) => void;
  setDragWidth: (width: number | null) => void;
  setIsResizing: (isResizing: boolean) => void;
}

export function selectSidebarPanelWidth(state: SidebarPanelState): number {
  return state.dragWidth ?? state.width;
}

function clampWidth(width: number): number {
  return Math.min(SIDEBAR_PANEL_MAX_WIDTH, Math.max(SIDEBAR_PANEL_MIN_WIDTH, Math.round(width)));
}

export const useSidebarPanel = create<SidebarPanelState>()(
  persist(
    (set) => ({
      width: SIDEBAR_PANEL_DEFAULT_WIDTH,
      dragWidth: null,
      isResizing: false,
      setWidth: (width) => set({ width: clampWidth(width), dragWidth: null }),
      setDragWidth: (dragWidth) =>
        set({
          dragWidth: dragWidth === null ? null : clampWidth(dragWidth),
        }),
      setIsResizing: (isResizing) => set({ isResizing }),
    }),
    {
      name: "l8db.sidebarPanel",
      partialize: (state) => ({ width: state.width }),
    },
  ),
);
