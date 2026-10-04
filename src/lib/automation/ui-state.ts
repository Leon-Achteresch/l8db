import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type AutomationViewId = "tasks" | "history" | "alerts" | "settings";
export type StepViewMode = "graph" | "list";

const STORAGE_KEY = "l8db.automation.ui";

interface AutomationUiState {
  collapsedFolders: string[];
  listWidth: number;
  lastView: AutomationViewId;
  stepView: StepViewMode;
  toggleFolder: (folder: string) => void;
  setListWidth: (width: number) => void;
  setLastView: (view: AutomationViewId) => void;
  setStepView: (view: StepViewMode) => void;
}

export const useAutomationUiState = create<AutomationUiState>()(
  persist(
    (set) => ({
      collapsedFolders: [],
      listWidth: 280,
      lastView: "tasks",
      stepView: "graph",
      toggleFolder: (folder) =>
        set((state) => ({
          collapsedFolders: state.collapsedFolders.includes(folder)
            ? state.collapsedFolders.filter((entry) => entry !== folder)
            : [...state.collapsedFolders, folder],
        })),
      setListWidth: (listWidth) =>
        set({ listWidth: Math.round(Math.min(560, Math.max(240, listWidth))) }),
      setLastView: (lastView) => set({ lastView }),
      setStepView: (stepView) => set({ stepView }),
    }),
    {
      name: STORAGE_KEY,
      partialize: ({ collapsedFolders, listWidth, lastView, stepView }) => ({
        collapsedFolders,
        listWidth,
        lastView,
        stepView,
      }),
    },
  ),
);

syncAcrossWindows(STORAGE_KEY, () => void useAutomationUiState.persist.rehydrate());
