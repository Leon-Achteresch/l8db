import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  rowLimit: number;
  editorFontSize: number;
  queryTimeout: number;
  sshTrustNewHosts: boolean;
  setRowLimit: (v: number) => void;
  setEditorFontSize: (v: number) => void;
  setQueryTimeout: (v: number) => void;
  setSshTrustNewHosts: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      rowLimit: 100,
      editorFontSize: 13,
      queryTimeout: 30,
      sshTrustNewHosts: false,
      setRowLimit: (rowLimit) => set({ rowLimit }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setQueryTimeout: (queryTimeout) => set({ queryTimeout }),
      setSshTrustNewHosts: (sshTrustNewHosts) => set({ sshTrustNewHosts }),
    }),
    { name: "l8db.settings" },
  ),
);
