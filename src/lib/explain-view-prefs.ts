import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ExplainViewMode = "tree" | "graph" | "flame";
export type ExplainGraphDirection = "DOWN" | "RIGHT";

interface ExplainViewPrefsState {
  view: ExplainViewMode;
  direction: ExplainGraphDirection;
  setView: (view: ExplainViewMode) => void;
  setDirection: (direction: ExplainGraphDirection) => void;
}

export const useExplainViewPrefs = create<ExplainViewPrefsState>()(
  persist(
    (set) => ({
      view: "tree",
      direction: "DOWN",
      setView: (view) => set({ view }),
      setDirection: (direction) => set({ direction }),
    }),
    { name: "l8db.explain-view" },
  ),
);
