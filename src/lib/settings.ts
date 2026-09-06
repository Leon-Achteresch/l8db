import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
  rowLimit: number;
  editorFontSize: number;
  queryTimeout: number;
  sshTrustNewHosts: boolean;
  transactionsEnabled: boolean;
  autoUpdateCheck: boolean;
  autoUpdateInstall: boolean;
  setRowLimit: (v: number) => void;
  setEditorFontSize: (v: number) => void;
  setQueryTimeout: (v: number) => void;
  setSshTrustNewHosts: (v: boolean) => void;
  setTransactionsEnabled: (v: boolean) => void;
  setAutoUpdateCheck: (v: boolean) => void;
  setAutoUpdateInstall: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      rowLimit: 100,
      editorFontSize: 13,
      queryTimeout: 30,
      sshTrustNewHosts: false,
      transactionsEnabled: true,
      autoUpdateCheck: true,
      autoUpdateInstall: false,
      setRowLimit: (rowLimit) => set({ rowLimit }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setQueryTimeout: (queryTimeout) => set({ queryTimeout }),
      setSshTrustNewHosts: (sshTrustNewHosts) => set({ sshTrustNewHosts }),
      setTransactionsEnabled: (transactionsEnabled) => set({ transactionsEnabled }),
      setAutoUpdateCheck: (autoUpdateCheck) =>
        set((state) => ({
          autoUpdateCheck,
          autoUpdateInstall: autoUpdateCheck ? state.autoUpdateInstall : false,
        })),
      setAutoUpdateInstall: (autoUpdateInstall) => set({ autoUpdateInstall }),
    }),
    { name: "l8db.settings" },
  ),
);
