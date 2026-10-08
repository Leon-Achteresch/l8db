import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { TableDetailTab } from "@/lib/table-detail-tabs";
import { normalizeTableStyle, type TableStyle } from "@/lib/table-style";
import { syncAcrossWindows } from "@/lib/window-sync";

export type SqlKeywordCase = "upper" | "lower" | "preserve";
export type UiDensity = "compact" | "normal" | "spacious";
export type SslDefaultMode = "prefer" | "require" | "disable" | "verify-full";
export type EditorWhitespace = "none" | "boundary" | "selection" | "trailing" | "all";
export type EditorWrappingIndent = "same" | "indent" | "deepIndent";
export type EditorAcceptSuggestionOnEnter = "on" | "smart" | "off";
export type EditorTabCompletion = "on" | "off" | "onlySnippets";
export type SidebarObjectNav = "tabs" | "select";
export type UpdateChannel = "stable" | "canary";

export type EditorKeymap = "default" | "vim";
export type EditorFontFamily =
  | "system"
  | "sf-mono"
  | "menlo"
  | "consolas"
  | "cascadia"
  | "fira"
  | "jetbrains";

export interface SettingsState {
  easyMode: boolean;
  setEasyMode: (value: boolean) => void;
  hiddenTableDetailTabs: TableDetailTab[];
  setTableDetailTabVisible: (tab: TableDetailTab, visible: boolean) => void;
  resetTableDetailTabs: () => void;
  rowLimit: number;
  editorFontSize: number;
  queryTimeout: number;
  sshTrustNewHosts: boolean;
  transactionsEnabled: boolean;
  transactionsPerTable: boolean;
  autoFeatureVideos: boolean;
  setAutoFeatureVideos: (value: boolean) => void;
  autoUpdateCheck: boolean;
  crashReports: boolean;
  setCrashReports: (value: boolean) => void;
  usageMetrics: boolean;
  setUsageMetrics: (value: boolean) => void;
  localUsageStats: boolean;
  setLocalUsageStats: (value: boolean) => void;
  autoUpdateInstall: boolean;
  updateChannel: UpdateChannel;
  skippedUpdateVersion: string | null;
  tourFinished: boolean;
  onboardingDone: boolean;
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
  editorKeymap: EditorKeymap;
  confirmDestructiveQueries: boolean;
  productionReadOnly: boolean;
  productionConfirmCommit: boolean;
  productionAutoRollback: boolean;
  highlightNullValues: boolean;
  translateFilterOperators: boolean;
  hideOwnSchemaSelect: boolean;
  sidebarObjectNav: SidebarObjectNav;
  searchIncludeColumns: boolean;
  searchIncludePackageMembers: boolean;
  uiDensity: UiDensity;
  uiScale: number;
  sidebarExtraCompact: boolean;
  navInHeader: boolean;
  dynamicIsland: boolean;
  fitColumnsToHeader: boolean;
  monochromeCells: boolean;
  tableStyle: TableStyle;
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
  setUpdateChannel: (v: UpdateChannel) => void;
  setSkippedUpdateVersion: (v: string | null) => void;
  setTourFinished: (v: boolean) => void;
  setOnboardingDone: (v: boolean) => void;
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
  setEditorKeymap: (v: EditorKeymap) => void;
  setConfirmDestructiveQueries: (v: boolean) => void;
  setProductionReadOnly: (v: boolean) => void;
  setProductionConfirmCommit: (v: boolean) => void;
  setProductionAutoRollback: (v: boolean) => void;
  setHighlightNullValues: (v: boolean) => void;
  setTranslateFilterOperators: (value: boolean) => void;
  setHideOwnSchemaSelect: (value: boolean) => void;
  setSidebarObjectNav: (value: SidebarObjectNav) => void;
  setSearchIncludeColumns: (v: boolean) => void;
  setSearchIncludePackageMembers: (v: boolean) => void;
  setUiDensity: (v: UiDensity) => void;
  setUiScale: (v: number) => void;
  resetAppearance: () => void;
  setSidebarExtraCompact: (value: boolean) => void;
  setNavInHeader: (value: boolean) => void;
  setDynamicIsland: (value: boolean) => void;
  setFitColumnsToHeader: (value: boolean) => void;
  setMonochromeCells: (value: boolean) => void;
  setTableStyle: (value: TableStyle) => void;
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

export const DEFAULT_SETTINGS = {
  easyMode: false,
  hiddenTableDetailTabs: [] as TableDetailTab[],
  rowLimit: 100,
  editorFontSize: 13,
  queryTimeout: 30,
  sshTrustNewHosts: false,
  transactionsEnabled: true,
  transactionsPerTable: true,
  autoFeatureVideos: true,
  autoUpdateCheck: true,
  crashReports: false,
  usageMetrics: false,
  localUsageStats: false,
  autoUpdateInstall: false,
  updateChannel: "stable" as UpdateChannel,
  skippedUpdateVersion: null,
  tourFinished: false,
  onboardingDone: false,
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
  editorKeymap: "default" as EditorKeymap,
  confirmDestructiveQueries: true,
  productionReadOnly: true,
  productionConfirmCommit: true,
  productionAutoRollback: false,
  highlightNullValues: true,
  translateFilterOperators: true,
  hideOwnSchemaSelect: true,
  sidebarObjectNav: "tabs" as SidebarObjectNav,
  searchIncludeColumns: true,
  searchIncludePackageMembers: true,
  uiDensity: "normal" as UiDensity,
  uiScale: 100,
  sidebarExtraCompact: false,
  navInHeader: false,
  dynamicIsland: true,
  fitColumnsToHeader: true,
  monochromeCells: true,
  tableStyle: "classic" as TableStyle,
  connectionTimeout: 15,
  sslDefaultMode: "prefer" as SslDefaultMode,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      setEasyMode: (easyMode) => set({ easyMode }),
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
      setAutoFeatureVideos: (autoFeatureVideos) => set({ autoFeatureVideos }),
      setAutoUpdateCheck: (autoUpdateCheck) =>
        set((state) => ({
          autoUpdateCheck,
          autoUpdateInstall: autoUpdateCheck ? state.autoUpdateInstall : false,
        })),
      setAutoUpdateInstall: (autoUpdateInstall) => set({ autoUpdateInstall }),
      setUpdateChannel: (updateChannel) => set({ updateChannel }),
      setCrashReports: (crashReports) => set({ crashReports }),
      setUsageMetrics: (usageMetrics) => set({ usageMetrics }),
      setLocalUsageStats: (localUsageStats) => set({ localUsageStats }),
      setSkippedUpdateVersion: (skippedUpdateVersion) => set({ skippedUpdateVersion }),
      setTourFinished: (tourFinished) => set({ tourFinished }),
      setOnboardingDone: (onboardingDone) => set({ onboardingDone }),
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
      setEditorKeymap: (editorKeymap) => set({ editorKeymap }),
      setConfirmDestructiveQueries: (confirmDestructiveQueries) =>
        set({ confirmDestructiveQueries }),
      setProductionReadOnly: (productionReadOnly) => set({ productionReadOnly }),
      setProductionConfirmCommit: (productionConfirmCommit) => set({ productionConfirmCommit }),
      setProductionAutoRollback: (productionAutoRollback) => set({ productionAutoRollback }),
      setHighlightNullValues: (highlightNullValues) => set({ highlightNullValues }),
      setTranslateFilterOperators: (translateFilterOperators) => set({ translateFilterOperators }),
      setHideOwnSchemaSelect: (hideOwnSchemaSelect) => set({ hideOwnSchemaSelect }),
      setSidebarObjectNav: (sidebarObjectNav) => set({ sidebarObjectNav }),
      setSearchIncludeColumns: (searchIncludeColumns) => set({ searchIncludeColumns }),
      setSearchIncludePackageMembers: (searchIncludePackageMembers) =>
        set({ searchIncludePackageMembers }),
      setUiDensity: (uiDensity) => set({ uiDensity: normalizeUiDensity(uiDensity) }),
      setUiScale: (uiScale) => set({ uiScale: normalizeUiScale(uiScale) }),
      setSidebarExtraCompact: (sidebarExtraCompact) => set({ sidebarExtraCompact }),
      setNavInHeader: (navInHeader) => set({ navInHeader }),
      setDynamicIsland: (dynamicIsland) => set({ dynamicIsland }),
      setFitColumnsToHeader: (fitColumnsToHeader) => set({ fitColumnsToHeader }),
      setMonochromeCells: (monochromeCells) => set({ monochromeCells }),
      setTableStyle: (tableStyle) => set({ tableStyle: normalizeTableStyle(tableStyle) }),
      resetAppearance: () =>
        set({
          uiScale: 100,
          uiDensity: "normal",
          sidebarExtraCompact: false,
          navInHeader: false,
          dynamicIsland: true,
          fitColumnsToHeader: true,
          monochromeCells: true,
          tableStyle: "classic",
        }),
      setConnectionTimeout: (connectionTimeout) => set({ connectionTimeout }),
      setSslDefaultMode: (sslDefaultMode) => set({ sslDefaultMode }),
      resetToDefaults: () =>
        set((state) => ({
          ...DEFAULT_SETTINGS,
          tourFinished: state.tourFinished,
          onboardingDone: state.onboardingDone,
        })),
    }),
    {
      name: "l8db.settings",
      version: 1,
      migrate: (persisted, version) =>
        version < 1
          ? { ...(persisted as Record<string, unknown>), productionReadOnly: true }
          : persisted,
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        return {
          ...current,
          ...saved,
          easyMode: saved?.easyMode === true,
          autoFeatureVideos: saved?.autoFeatureVideos !== false,
          onboardingDone: saved?.onboardingDone === true,
          crashReports: saved?.crashReports === true,
          usageMetrics: saved?.usageMetrics === true,
          localUsageStats: saved?.localUsageStats === true,
          translateFilterOperators: saved?.translateFilterOperators !== false,
          uiScale: normalizeUiScale(saved?.uiScale),
          uiDensity: normalizeUiDensity(saved?.uiDensity),
          sidebarExtraCompact: saved?.sidebarExtraCompact === true,
          sidebarObjectNav: saved?.sidebarObjectNav === "select" ? "select" : "tabs",
          navInHeader: saved?.navInHeader === true,
          dynamicIsland: saved?.dynamicIsland !== false,
          fitColumnsToHeader: saved?.fitColumnsToHeader !== false,
          monochromeCells: saved?.monochromeCells !== false,
          tableStyle: normalizeTableStyle(saved?.tableStyle),
          editorKeymap: saved?.editorKeymap === "vim" ? "vim" : "default",
          updateChannel: saved?.updateChannel === "canary" ? "canary" : "stable",
        };
      },
    },
  ),
);

syncAcrossWindows("l8db.settings", () => void useSettingsStore.persist.rehydrate());
