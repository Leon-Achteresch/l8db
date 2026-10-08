import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type NotebookLayout = "column" | "book";

export const useNotebookLayout = create<{
  layout: NotebookLayout;
  setLayout: (layout: NotebookLayout) => void;
}>()(
  persist((set) => ({ layout: "column", setLayout: (layout) => set({ layout }) }), {
    name: "l8db.notebook-layout",
  }),
);

syncAcrossWindows("l8db.notebook-layout", () => void useNotebookLayout.persist.rehydrate());
