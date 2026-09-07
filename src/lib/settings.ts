import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SqlKeywordCase = "upper" | "lower" | "preserve";
export type UiDensity = "compact" | "normal" | "spacious";
export type SslDefaultMode = "prefer" | "require" | "disable" | "verify-full";

export interface SettingsState {
  rowLimit: number;
  editorFontSize: number;
  queryTimeout: number;
  sshTrustNewHosts: boolean;
  transactionsEnabled: boolean;
  autoUpdateCheck: boolean;
  autoUpdateInstall: boolean;
  tourFinished: boolean;
  editorTabSize: number;
  editorKeywordCase: SqlKeywordCase;
  editorWordWrap: boolean;
  editorLineNumbers: boolean;
  editorMinimap: boolean;
  confirmDestructiveQueries: boolean;
  highlightNullValues: boolean;
  uiDensity: UiDensity;
  connectionTimeout: number;
  sslDefaultMode: SslDefaultMode;
  setRowLimit: (v: number) => void;
  setEditorFontSize: (v: number) => void;
  setQueryTimeout: (v: number) => void;
  setSshTrustNewHosts: (v: boolean) => void;
  setTransactionsEnabled: (v: boolean) => void;
  setAutoUpdateCheck: (v: boolean) => void;
  setAutoUpdateInstall: (v: boolean) => void;
  setTourFinished: (v: boolean) => void;
  setEditorTabSize: (v: number) => void;
  setEditorKeywordCase: (v: SqlKeywordCase) => void;
  setEditorWordWrap: (v: boolean) => void;
  setEditorLineNumbers: (v: boolean) => void;
  setEditorMinimap: (v: boolean) => void;
  setConfirmDestructiveQueries: (v: boolean) => void;
  setHighlightNullValues: (v: boolean) => void;
  setUiDensity: (v: UiDensity) => void;
  setConnectionTimeout: (v: number) => void;
  setSslDefaultMode: (v: SslDefaultMode) => void;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS = {
  rowLimit: 100,
  editorFontSize: 13,
  queryTimeout: 30,
  sshTrustNewHosts: false,
  transactionsEnabled: true,
  autoUpdateCheck: true,
  autoUpdateInstall: false,
  tourFinished: false,
  editorTabSize: 2,
  editorKeywordCase: "upper" as SqlKeywordCase,
  editorWordWrap: true,
  editorLineNumbers: true,
  editorMinimap: false,
  confirmDestructiveQueries: true,
  highlightNullValues: true,
  uiDensity: "normal" as UiDensity,
  connectionTimeout: 15,
  sslDefaultMode: "prefer" as SslDefaultMode,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
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
      setTourFinished: (tourFinished) => set({ tourFinished }),
      setEditorTabSize: (editorTabSize) => set({ editorTabSize }),
      setEditorKeywordCase: (editorKeywordCase) => set({ editorKeywordCase }),
      setEditorWordWrap: (editorWordWrap) => set({ editorWordWrap }),
      setEditorLineNumbers: (editorLineNumbers) => set({ editorLineNumbers }),
      setEditorMinimap: (editorMinimap) => set({ editorMinimap }),
      setConfirmDestructiveQueries: (confirmDestructiveQueries) =>
        set({ confirmDestructiveQueries }),
      setHighlightNullValues: (highlightNullValues) => set({ highlightNullValues }),
      setUiDensity: (uiDensity) => set({ uiDensity }),
      setConnectionTimeout: (connectionTimeout) => set({ connectionTimeout }),
      setSslDefaultMode: (sslDefaultMode) => set({ sslDefaultMode }),
      resetToDefaults: () =>
        set((state) => ({
          ...DEFAULT_SETTINGS,
          tourFinished: state.tourFinished,
        })),
    }),
    { name: "l8db.settings" },
  ),
);
