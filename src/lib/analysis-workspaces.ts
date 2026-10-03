import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DataCompareSideSelection } from "@/features/compare/data-compare-side-picker";
import type { CompareSideSelection } from "@/lib/compare-types";
import { syncAcrossWindows } from "@/lib/window-sync";

export interface AnalysisWorkspace {
  id: string;
  name: string;
  tab: "definitions" | "data";
  left: CompareSideSelection;
  right: CompareSideSelection;
  dataLeft: DataCompareSideSelection;
  dataRight: DataCompareSideSelection;
}
export const useAnalysisWorkspaces = create<{ workspaces: AnalysisWorkspace[] }>()(
  persist(() => ({ workspaces: [] as AnalysisWorkspace[] }), { name: "l8db.analysis-workspaces" }),
);
export function saveAnalysisWorkspace(value: Omit<AnalysisWorkspace, "id">) {
  const name = value.name.trim();
  if (!name) return;
  useAnalysisWorkspaces.setState((state) => ({
    workspaces: [
      { ...value, name, id: crypto.randomUUID() },
      ...state.workspaces.filter((entry) => entry.name !== name),
    ].slice(0, 100),
  }));
}

syncAcrossWindows("l8db.analysis-workspaces", () => void useAnalysisWorkspaces.persist.rehydrate());
