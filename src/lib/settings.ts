import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { TableDetailTab } from "@/lib/table-detail-tabs";

export type SqlKeywordCase = "upper" | "lower" | "preserve";
export type UiDensity = "compact" | "normal" | "spacious";
export type SslDefaultMode = "prefer" | "require" | "disable" | "verify-full";
export type EditorWhitespace = "none" | "boundary" | "selection" | "trailing" | "all";
export type EditorWrappingIndent = "same" | "indent" | "deepIndent";
export type EditorAcceptSuggestionOnEnter = "on" | "smart" | "off";
export type EditorTabCompletion = "on" | "off" | "onlySnippets";
export type EditorFontFamily =
  | "system"
  | "sf-mono"
  | "menlo"
  | "consolas"
  | "cascadia"
  | "fira"
  | "jetbrains";

export interface SettingsState {
  hiddenTableDetailTabs: TableDetailTab[];
  setTableDetailTabVisible: (tab: TableDetailTab, visible: boolean) => void;
  resetTableDetailTabs: () => void;
  rowLimit: number;
  editorFontSize: number;
  queryTimeout: number;
  sshTrustNewHosts: boolean;
  transactionsEnabled: boolean;
  transactionsPerTable: boolean;
  autoUpdateCheck: boolean;
  autoUpdateInstall: boolean;
  skippedUpdateVersion: string | null;
  tourFinished: boolean;
  editorTabSize: number;
  editorKeywordCase: SqlKeywordCase;
  editorWordWrap: boolean;
  editorLineNumbers: boolean;
  editorMinimap: boolean;
  editorFontFamily: EditorFontFamily;
  editorFontLigatures: boolean;
  editorLineHeight: number;
  editorMinimapScale: number;
  editorBracketPairColorization: boolean;
  editorGuidesBracketPairs: boolean;
  editorGuidesIndentation: boolean;
  editorRenderWhitespace: EditorWhitespace;
  editorRulers: number[];
  editorSmoothScrolling: boolean;
  editorWrappingIndent: EditorWrappingIndent;
  editorQuickSuggestions: boolean;
  editorSuggestOnTriggerCharacters: boolean;
  editorSuggestDelay: number;
  editorAcceptSuggestionOnEnter: EditorAcceptSuggestionOnEnter;
  editorTabCompletion: EditorTabCompletion;
  editorParameterHints: boolean;
  editorFormatOnPaste: boolean;
  editorFormatOnType: boolean;
  editorFormatDenseOperators: boolean;
  editorFormatNewlineBeforeSemicolon: boolean;
  editorFormatLinesBetweenQueries: number;
  confirmDestructiveQueries: boolean;
  highlightNullValues: boolean;
  searchIncludeColumns: boolean;
  uiDensity: UiDensity;
  uiScale: number;
  sidebarExtraCompact: boolean;
  connectionTimeout: number;
  sslDefaultMode: SslDefaultMode;
  setRowLimit: (v: number) => void;
  setEditorFontSize: (v: number) => void;
  setQueryTimeout: (v: number) => void;
  setSshTrustNewHosts: (v: boolean) => void;
  setTransactionsEnabled: (v: boolean) => void;
  setTransactionsPerTable: (v: boolean) => void;
  setAutoUpdateCheck: (v: boolean) => void;
  setAutoUpdateInstall: (v: boolean) => void;
  setSkippedUpdateVersion: (v: string | null) => void;
  setTourFinished: (v: boolean) => void;
  setEditorTabSize: (v: number) => void;
  setEditorKeywordCase: (v: SqlKeywordCase) => void;
  setEditorWordWrap: (v: boolean) => void;
  setEditorLineNumbers: (v: boolean) => void;
  setEditorMinimap: (v: boolean) => void;
  setEditorFontFamily: (v: EditorFontFamily) => void;
  setEditorFontLigatures: (v: boolean) => void;
  setEditorLineHeight: (v: number) => void;
  setEditorMinimapScale: (v: number) => void;
  setEditorBracketPairColorization: (v: boolean) => void;
  setEditorGuidesBracketPairs: (v: boolean) => void;
  setEditorGuidesIndentation: (v: boolean) => void;
  setEditorRenderWhitespace: (v: EditorWhitespace) => void;
  setEditorRulers: (v: number[]) => void;
  setEditorSmoothScrolling: (v: boolean) => void;
  setEditorWrappingIndent: (v: EditorWrappingIndent) => void;
  setEditorQuickSuggestions: (v: boolean) => void;
  setEditorSuggestOnTriggerCharacters: (v: boolean) => void;
  setEditorSuggestDelay: (v: number) => void;
  setEditorAcceptSuggestionOnEnter: (v: EditorAcceptSuggestionOnEnter) => void;
  setEditorTabCompletion: (v: EditorTabCompletion) => void;
  setEditorParameterHints: (v: boolean) => void;
  setEditorFormatOnPaste: (v: boolean) => void;
  setEditorFormatOnType: (v: boolean) => void;
  setEditorFormatDenseOperators: (v: boolean) => void;
  setEditorFormatNewlineBeforeSemicolon: (v: boolean) => void;
  setEditorFormatLinesBetweenQueries: (v: number) => void;
  setConfirmDestructiveQueries: (v: boolean) => void;
  setHighlightNullValues: (v: boolean) => void;
  setSearchIncludeColumns: (v: boolean) => void;
  setUiDensity: (v: UiDensity) => void;
  setUiScale: (v: number) => void;
  resetAppearance: () => void;
  setSidebarExtraCompact: (value: boolean) => void;
  setConnectionTimeout: (v: number) => void;
  setSslDefaultMode: (v: SslDefaultMode) => void;
  resetToDefaults: () => void;
}

export const UI_SCALE_MIN = 80;
export const UI_SCALE_MAX = 150;
export const UI_SCALE_STEP = 5;

export function normalizeUiScale(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 100;
  return Math.min(
    UI_SCALE_MAX,
    Math.max(UI_SCALE_MIN, Math.round(value / UI_SCALE_STEP) * UI_SCALE_STEP),
  );
}

export function normalizeUiDensity(value: unknown): UiDensity {
  return value === "compact" || value === "spacious" ? value : "normal";
}

const DEFAULT_SETTINGS = {
  hiddenTableDetailTabs: [] as TableDetailTab[],
  rowLimit: 100,
  editorFontSize: 13,
  queryTimeout: 30,
  sshTrustNewHosts: false,
  transactionsEnabled: true,
  transactionsPerTable: true,
  autoUpdateCheck: true,
  autoUpdateInstall: false,
  skippedUpdateVersion: null,
  tourFinished: false,
  editorTabSize: 2,
  editorKeywordCase: "upper" as SqlKeywordCase,
  editorWordWrap: true,
  editorLineNumbers: true,
  editorMinimap: false,
  editorFontFamily: "system" as EditorFontFamily,
  editorFontLigatures: false,
  editorLineHeight: 1.8,
  editorMinimapScale: 1,
  editorBracketPairColorization: true,
  editorGuidesBracketPairs: true,
  editorGuidesIndentation: false,
  editorRenderWhitespace: "selection" as EditorWhitespace,
  editorRulers: [] as number[],
  editorSmoothScrolling: true,
  editorWrappingIndent: "same" as EditorWrappingIndent,
  editorQuickSuggestions: true,
  editorSuggestOnTriggerCharacters: true,
  editorSuggestDelay: 50,
  editorAcceptSuggestionOnEnter: "on" as EditorAcceptSuggestionOnEnter,
  editorTabCompletion: "off" as EditorTabCompletion,
  editorParameterHints: true,
  editorFormatOnPaste: false,
  editorFormatOnType: false,
  editorFormatDenseOperators: false,
  editorFormatNewlineBeforeSemicolon: false,
  editorFormatLinesBetweenQueries: 2,
  confirmDestructiveQueries: true,
  highlightNullValues: true,
  searchIncludeColumns: true,
  uiDensity: "normal" as UiDensity,
  uiScale: 100,
  sidebarExtraCompact: false,
  connectionTimeout: 15,
  sslDefaultMode: "prefer" as SslDefaultMode,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setTableDetailTabVisible: (tab, visible) =>
        set((state) => ({
          hiddenTableDetailTabs: visible
            ? state.hiddenTableDetailTabs.filter((id) => id !== tab)
            : [...new Set([...state.hiddenTableDetailTabs, tab])],
        })),
      resetTableDetailTabs: () => set({ hiddenTableDetailTabs: [] }),
      setRowLimit: (rowLimit) => set({ rowLimit }),
      setEditorFontSize: (editorFontSize) => set({ editorFontSize }),
      setQueryTimeout: (queryTimeout) => set({ queryTimeout }),
      setSshTrustNewHosts: (sshTrustNewHosts) => set({ sshTrustNewHosts }),
      setTransactionsEnabled: (transactionsEnabled) => set({ transactionsEnabled }),
      setTransactionsPerTable: (transactionsPerTable) => set({ transactionsPerTable }),
      setAutoUpdateCheck: (autoUpdateCheck) =>
        set((state) => ({
          autoUpdateCheck,
          autoUpdateInstall: autoUpdateCheck ? state.autoUpdateInstall : false,
        })),
      setAutoUpdateInstall: (autoUpdateInstall) => set({ autoUpdateInstall }),
      setSkippedUpdateVersion: (skippedUpdateVersion) => set({ skippedUpdateVersion }),
      setTourFinished: (tourFinished) => set({ tourFinished }),
      setEditorTabSize: (editorTabSize) => set({ editorTabSize }),
      setEditorKeywordCase: (editorKeywordCase) => set({ editorKeywordCase }),
      setEditorWordWrap: (editorWordWrap) => set({ editorWordWrap }),
      setEditorLineNumbers: (editorLineNumbers) => set({ editorLineNumbers }),
      setEditorMinimap: (editorMinimap) => set({ editorMinimap }),
      setEditorFontFamily: (editorFontFamily) => set({ editorFontFamily }),
      setEditorFontLigatures: (editorFontLigatures) => set({ editorFontLigatures }),
      setEditorLineHeight: (editorLineHeight) => set({ editorLineHeight }),
      setEditorMinimapScale: (editorMinimapScale) => set({ editorMinimapScale }),
      setEditorBracketPairColorization: (editorBracketPairColorization) =>
        set({ editorBracketPairColorization }),
      setEditorGuidesBracketPairs: (editorGuidesBracketPairs) => set({ editorGuidesBracketPairs }),
      setEditorGuidesIndentation: (editorGuidesIndentation) => set({ editorGuidesIndentation }),
      setEditorRenderWhitespace: (editorRenderWhitespace) => set({ editorRenderWhitespace }),
      setEditorRulers: (editorRulers) => set({ editorRulers }),
      setEditorSmoothScrolling: (editorSmoothScrolling) => set({ editorSmoothScrolling }),
      setEditorWrappingIndent: (editorWrappingIndent) => set({ editorWrappingIndent }),
      setEditorQuickSuggestions: (editorQuickSuggestions) => set({ editorQuickSuggestions }),
      setEditorSuggestOnTriggerCharacters: (editorSuggestOnTriggerCharacters) =>
        set({ editorSuggestOnTriggerCharacters }),
      setEditorSuggestDelay: (editorSuggestDelay) => set({ editorSuggestDelay }),
      setEditorAcceptSuggestionOnEnter: (editorAcceptSuggestionOnEnter) =>
        set({ editorAcceptSuggestionOnEnter }),
      setEditorTabCompletion: (editorTabCompletion) => set({ editorTabCompletion }),
      setEditorParameterHints: (editorParameterHints) => set({ editorParameterHints }),
      setEditorFormatOnPaste: (editorFormatOnPaste) => set({ editorFormatOnPaste }),
      setEditorFormatOnType: (editorFormatOnType) => set({ editorFormatOnType }),
      setEditorFormatDenseOperators: (editorFormatDenseOperators) =>
        set({ editorFormatDenseOperators }),
      setEditorFormatNewlineBeforeSemicolon: (editorFormatNewlineBeforeSemicolon) =>
        set({ editorFormatNewlineBeforeSemicolon }),
      setEditorFormatLinesBetweenQueries: (editorFormatLinesBetweenQueries) =>
        set({ editorFormatLinesBetweenQueries }),
      setConfirmDestructiveQueries: (confirmDestructiveQueries) =>
        set({ confirmDestructiveQueries }),
      setHighlightNullValues: (highlightNullValues) => set({ highlightNullValues }),
      setSearchIncludeColumns: (searchIncludeColumns) => set({ searchIncludeColumns }),
      setUiDensity: (uiDensity) => set({ uiDensity: normalizeUiDensity(uiDensity) }),
      setUiScale: (uiScale) => set({ uiScale: normalizeUiScale(uiScale) }),
      setSidebarExtraCompact: (sidebarExtraCompact) => set({ sidebarExtraCompact }),
      resetAppearance: () => set({ uiScale: 100, uiDensity: "normal", sidebarExtraCompact: false }),
      setConnectionTimeout: (connectionTimeout) => set({ connectionTimeout }),
      setSslDefaultMode: (sslDefaultMode) => set({ sslDefaultMode }),
      resetToDefaults: () =>
        set((state) => ({
          ...DEFAULT_SETTINGS,
          tourFinished: state.tourFinished,
        })),
    }),
    {
      name: "l8db.settings",
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        return {
          ...current,
          ...saved,
          uiScale: normalizeUiScale(saved?.uiScale),
          uiDensity: normalizeUiDensity(saved?.uiDensity),
          sidebarExtraCompact: saved?.sidebarExtraCompact === true,
        };
      },
    },
  ),
);
