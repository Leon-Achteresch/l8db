import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  type AppTheme,
  DEFAULT_APP_THEME,
  MAX_CUSTOM_THEMES,
  normalizeAppTheme,
  normalizeCustomTheme,
  normalizeCustomThemes,
} from "@/lib/app-themes";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import {
  DEFAULT_DISCOVERY_SETTINGS,
  type DiscoverySettings,
  normalizeDiscoverySettings,
} from "@/lib/discovery/channels";
import { type DmlPreviewMode, normalizeDmlPreviewMode } from "@/lib/dml-preview/mode";
import { type FilterBarStyle, normalizeFilterBarStyle } from "@/lib/filter-bar-style";
import { applyOrganizationSettings, withOrganizationSettings } from "@/lib/organization-state";
import type { TableDetailTab } from "@/lib/table-detail-tabs";
import { normalizeTableStyle, type TableStyle } from "@/lib/table-style";
import { syncAcrossWindows } from "@/lib/window-sync";

export type SqlKeywordCase = "upper" | "lower" | "preserve";
export type UiDensity = "compact" | "normal" | "spacious";
export type SslDefaultMode = "prefer" | "require" | "disable" | "verify-ca" | "verify-full";
export type EditorWhitespace = "none" | "boundary" | "selection" | "trailing" | "all";
export type EditorWrappingIndent = "same" | "indent" | "deepIndent";
export type EditorAcceptSuggestionOnEnter = "on" | "smart" | "off";
export type EditorTabCompletion = "on" | "off" | "onlySnippets";
export type PlsqlWarningLevel = "enable" | "disable" | "error";
export interface PlsqlWarningRules {
  severe: PlsqlWarningLevel;
  performance: PlsqlWarningLevel;
  informational: PlsqlWarningLevel;
  ignore: number[];
  error: number[];
}
export type SidebarObjectNav = "tabs" | "select";
export type UpdateChannel = "stable" | "canary";
export type CollectCellEdits = "off" | "production" | "always";
export type TableFilterMode = "simple" | "sql";

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
  collectCellEdits: CollectCellEdits;
  autoFeatureVideos: boolean;
  setAutoFeatureVideos: (value: boolean) => void;
  blogSuggestions: boolean;
  setBlogSuggestions: (value: boolean) => void;
  successToasts: boolean;
  setSuccessToasts: (value: boolean) => void;
  discovery: DiscoverySettings;
  setDiscovery: (value: Partial<DiscoverySettings>) => void;
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
  oraclePlsqlWarnings: boolean;
  oraclePlsqlWarningRules: PlsqlWarningRules;
  editorFormatOnPaste: boolean;
  editorFormatOnType: boolean;
  editorFormatDenseOperators: boolean;
  editorFormatNewlineBeforeSemicolon: boolean;
  editorFormatLinesBetweenQueries: number;
  editorBlankLineTerminator: boolean;
  editorKeymap: EditorKeymap;
  confirmDestructiveQueries: boolean;
  productionReadOnly: boolean;
  productionConfirmCommit: boolean;
  productionAutoRollback: boolean;
  dmlPreviewMode: DmlPreviewMode;
  dmlPreviewRowLimit: number;
  dmlPreviewTimeout: number;
  dmlPreviewLockTimeout: number;
  dmlPreviewWarnThreshold: number;
  multiTargetConcurrency: number;
  multiTargetRowLimit: number;
  multiTargetTimeout: number;
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
  shortcutHints: boolean;
  newFeatureBadges: boolean;
  seasonalAccents: boolean;
  lightTheme: string;
  darkTheme: string;
  customThemes: AppTheme[];
  dbThemes: boolean;
  fitColumnsToHeader: boolean;
  monochromeCells: boolean;
  tableStyle: TableStyle;
  filterBarStyle: FilterBarStyle;
  filterBarSorting: boolean;
  tableFilterMode: TableFilterMode;
  connectionTimeout: number;
  sslDefaultMode: SslDefaultMode;
  setRowLimit: (v: number) => void;
  setEditorFontSize: (v: number) => void;
  setQueryTimeout: (v: number) => void;
  setSshTrustNewHosts: (v: boolean) => void;
  setTransactionsEnabled: (v: boolean) => void;
  setTransactionsPerTable: (v: boolean) => void;
  setCollectCellEdits: (v: CollectCellEdits) => void;
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
  setOraclePlsqlWarnings: (v: boolean) => void;
  setOraclePlsqlWarningRules: (v: PlsqlWarningRules) => void;
  setEditorFormatOnPaste: (v: boolean) => void;
  setEditorFormatOnType: (v: boolean) => void;
  setEditorFormatDenseOperators: (v: boolean) => void;
  setEditorFormatNewlineBeforeSemicolon: (v: boolean) => void;
  setEditorFormatLinesBetweenQueries: (v: number) => void;
  setEditorBlankLineTerminator: (v: boolean) => void;
  setEditorKeymap: (v: EditorKeymap) => void;
  setConfirmDestructiveQueries: (v: boolean) => void;
  setProductionReadOnly: (v: boolean) => void;
  setProductionConfirmCommit: (v: boolean) => void;
  setProductionAutoRollback: (v: boolean) => void;
  setDmlPreviewMode: (v: DmlPreviewMode) => void;
  setDmlPreviewRowLimit: (v: number) => void;
  setDmlPreviewTimeout: (v: number) => void;
  setDmlPreviewLockTimeout: (v: number) => void;
  setDmlPreviewWarnThreshold: (v: number) => void;
  setMultiTargetConcurrency: (v: number) => void;
  setMultiTargetRowLimit: (v: number) => void;
  setMultiTargetTimeout: (v: number) => void;
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
  setShortcutHints: (value: boolean) => void;
  setNewFeatureBadges: (value: boolean) => void;
  setSeasonalAccents: (value: boolean) => void;
  setLightTheme: (value: string) => void;
  setDarkTheme: (value: string) => void;
  saveCustomTheme: (theme: AppTheme) => boolean;
  deleteCustomTheme: (id: string) => void;
  setDbThemes: (value: boolean) => void;
  setFitColumnsToHeader: (value: boolean) => void;
  setMonochromeCells: (value: boolean) => void;
  setTableStyle: (value: TableStyle) => void;
  setFilterBarStyle: (value: FilterBarStyle) => void;
  setFilterBarSorting: (value: boolean) => void;
  setTableFilterMode: (value: TableFilterMode) => void;
  setConnectionTimeout: (v: number) => void;
  setSslDefaultMode: (v: SslDefaultMode) => void;
  resetToDefaults: () => void;
}

export const LAYOUT_APPEARANCE_DEFAULTS = {
  uiScale: 100,
  uiDensity: "normal",
  sidebarExtraCompact: false,
  navInHeader: false,
  dynamicIsland: true,
  seasonalAccents: true,
  lightTheme: DEFAULT_APP_THEME,
  darkTheme: DEFAULT_APP_THEME,
  dbThemes: false,
} satisfies Partial<SettingsState>;

export const TABLE_APPEARANCE_DEFAULTS = {
  fitColumnsToHeader: true,
  monochromeCells: true,
  tableStyle: "classic",
  filterBarStyle: "classic",
  filterBarSorting: false,
  tableFilterMode: "simple",
} satisfies Partial<SettingsState>;

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
  collectCellEdits: "production" as CollectCellEdits,
  autoFeatureVideos: true,
  blogSuggestions: true,
  successToasts: false,
  discovery: DEFAULT_DISCOVERY_SETTINGS,
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
  oraclePlsqlWarnings: false,
  oraclePlsqlWarningRules: {
    severe: "enable",
    performance: "enable",
    informational: "enable",
    ignore: [],
    error: [],
  } as PlsqlWarningRules,
  editorFormatOnPaste: false,
  editorFormatOnType: false,
  editorFormatDenseOperators: false,
  editorFormatNewlineBeforeSemicolon: false,
  editorFormatLinesBetweenQueries: 2,
  editorBlankLineTerminator: false,
  editorKeymap: "default" as EditorKeymap,
  confirmDestructiveQueries: true,
  productionReadOnly: true,
  productionConfirmCommit: true,
  productionAutoRollback: false,
  dmlPreviewMode: "production" as DmlPreviewMode,
  dmlPreviewRowLimit: 100,
  dmlPreviewTimeout: 10,
  dmlPreviewLockTimeout: 3,
  dmlPreviewWarnThreshold: 1000,
  multiTargetConcurrency: 4,
  multiTargetRowLimit: 1000,
  multiTargetTimeout: 30,
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
  shortcutHints: true,
  newFeatureBadges: true,
  seasonalAccents: true,
  lightTheme: DEFAULT_APP_THEME,
  darkTheme: DEFAULT_APP_THEME,
  customThemes: [] as AppTheme[],
  dbThemes: false,
  fitColumnsToHeader: true,
  monochromeCells: true,
  tableStyle: "classic" as TableStyle,
  filterBarStyle: "classic" as FilterBarStyle,
  filterBarSorting: false,
  tableFilterMode: "simple" as TableFilterMode,
  connectionTimeout: 15,
  sslDefaultMode: "prefer" as SslDefaultMode,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    withOrganizationSettings<SettingsState>((set, get) => ({
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
      setCollectCellEdits: (collectCellEdits) => set({ collectCellEdits }),
      setAutoFeatureVideos: (autoFeatureVideos) => set({ autoFeatureVideos }),
      setBlogSuggestions: (blogSuggestions) => set({ blogSuggestions }),
      setSuccessToasts: (successToasts) => set({ successToasts }),
      setDiscovery: (value) =>
        set((state) => ({
          discovery: normalizeDiscoverySettings({ ...state.discovery, ...value }),
        })),
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
      setOraclePlsqlWarnings: (oraclePlsqlWarnings) => set({ oraclePlsqlWarnings }),
      setOraclePlsqlWarningRules: (oraclePlsqlWarningRules) => set({ oraclePlsqlWarningRules }),
      setEditorFormatOnPaste: (editorFormatOnPaste) => set({ editorFormatOnPaste }),
      setEditorFormatOnType: (editorFormatOnType) => set({ editorFormatOnType }),
      setEditorFormatDenseOperators: (editorFormatDenseOperators) =>
        set({ editorFormatDenseOperators }),
      setEditorFormatNewlineBeforeSemicolon: (editorFormatNewlineBeforeSemicolon) =>
        set({ editorFormatNewlineBeforeSemicolon }),
      setEditorFormatLinesBetweenQueries: (editorFormatLinesBetweenQueries) =>
        set({ editorFormatLinesBetweenQueries }),
      setEditorBlankLineTerminator: (editorBlankLineTerminator) =>
        set({ editorBlankLineTerminator }),
      setEditorKeymap: (editorKeymap) => set({ editorKeymap }),
      setConfirmDestructiveQueries: (confirmDestructiveQueries) =>
        set({ confirmDestructiveQueries }),
      setProductionReadOnly: (productionReadOnly) => set({ productionReadOnly }),
      setProductionConfirmCommit: (productionConfirmCommit) => set({ productionConfirmCommit }),
      setProductionAutoRollback: (productionAutoRollback) => set({ productionAutoRollback }),
      setDmlPreviewMode: (dmlPreviewMode) =>
        set({ dmlPreviewMode: normalizeDmlPreviewMode(dmlPreviewMode) }),
      setDmlPreviewRowLimit: (dmlPreviewRowLimit) => set({ dmlPreviewRowLimit }),
      setDmlPreviewTimeout: (dmlPreviewTimeout) => set({ dmlPreviewTimeout }),
      setDmlPreviewLockTimeout: (dmlPreviewLockTimeout) => set({ dmlPreviewLockTimeout }),
      setDmlPreviewWarnThreshold: (dmlPreviewWarnThreshold) => set({ dmlPreviewWarnThreshold }),
      setMultiTargetConcurrency: (multiTargetConcurrency) =>
        set({
          multiTargetConcurrency: Math.max(1, Math.min(16, Math.floor(multiTargetConcurrency))),
        }),
      setMultiTargetRowLimit: (multiTargetRowLimit) => set({ multiTargetRowLimit }),
      setMultiTargetTimeout: (multiTargetTimeout) => set({ multiTargetTimeout }),
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
      setShortcutHints: (shortcutHints) => set({ shortcutHints }),
      setNewFeatureBadges: (newFeatureBadges) => set({ newFeatureBadges }),
      setSeasonalAccents: (seasonalAccents) => set({ seasonalAccents }),
      setLightTheme: (lightTheme) =>
        set({ lightTheme: normalizeAppTheme(lightTheme, get().customThemes) }),
      setDarkTheme: (darkTheme) =>
        set({ darkTheme: normalizeAppTheme(darkTheme, get().customThemes) }),
      saveCustomTheme: (theme) => {
        const next = normalizeCustomTheme(theme);
        if (!next) return false;
        const themes = get().customThemes;
        const index = themes.findIndex((entry) => entry.id === next.id);
        if (index < 0 && themes.length >= MAX_CUSTOM_THEMES) return false;
        set({
          customThemes:
            index < 0 ? [...themes, next] : themes.map((entry, i) => (i === index ? next : entry)),
        });
        return true;
      },
      deleteCustomTheme: (id) => {
        const state = get();
        set({
          customThemes: state.customThemes.filter((theme) => theme.id !== id),
          ...(state.lightTheme === id ? { lightTheme: DEFAULT_APP_THEME } : {}),
          ...(state.darkTheme === id ? { darkTheme: DEFAULT_APP_THEME } : {}),
        });
      },
      setDbThemes: (dbThemes) => set({ dbThemes }),
      setFitColumnsToHeader: (fitColumnsToHeader) => set({ fitColumnsToHeader }),
      setMonochromeCells: (monochromeCells) => set({ monochromeCells }),
      setTableStyle: (tableStyle) => set({ tableStyle: normalizeTableStyle(tableStyle) }),
      setFilterBarStyle: (filterBarStyle) =>
        set({ filterBarStyle: normalizeFilterBarStyle(filterBarStyle) }),
      setFilterBarSorting: (filterBarSorting) => set({ filterBarSorting }),
      setTableFilterMode: (tableFilterMode) =>
        set({ tableFilterMode: tableFilterMode === "sql" ? "sql" : "simple" }),
      resetAppearance: () => set({ ...LAYOUT_APPEARANCE_DEFAULTS, ...TABLE_APPEARANCE_DEFAULTS }),
      setConnectionTimeout: (connectionTimeout) => set({ connectionTimeout }),
      setSslDefaultMode: (sslDefaultMode) => set({ sslDefaultMode }),
      resetToDefaults: () =>
        set((state) => ({
          ...DEFAULT_SETTINGS,
          tourFinished: state.tourFinished,
          onboardingDone: state.onboardingDone,
        })),
    })),
    {
      name: "l8db.settings",
      storage: createSafeJsonStorage(),
      version: 2,
      migrate: (persisted, version) => ({
        ...(persisted as Record<string, unknown>),
        ...(version < 1 ? { productionReadOnly: true } : {}),
        ...(version < 2 ? { dbThemes: false } : {}),
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<SettingsState> | undefined;
        const customThemes = normalizeCustomThemes(saved?.customThemes);
        return applyOrganizationSettings({
          ...current,
          ...saved,
          easyMode: saved?.easyMode === true,
          autoFeatureVideos: saved?.autoFeatureVideos !== false,
          blogSuggestions: saved?.blogSuggestions !== false,
          successToasts: saved?.successToasts === true,
          discovery: normalizeDiscoverySettings(saved?.discovery),
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
          shortcutHints: saved?.shortcutHints !== false,
          newFeatureBadges: saved?.newFeatureBadges !== false,
          seasonalAccents: saved?.seasonalAccents !== false,
          customThemes,
          lightTheme: normalizeAppTheme(saved?.lightTheme, customThemes),
          darkTheme: normalizeAppTheme(saved?.darkTheme, customThemes),
          dbThemes: saved?.dbThemes === true,
          fitColumnsToHeader: saved?.fitColumnsToHeader !== false,
          monochromeCells: saved?.monochromeCells !== false,
          tableStyle: normalizeTableStyle(saved?.tableStyle),
          filterBarStyle: normalizeFilterBarStyle(saved?.filterBarStyle),
          filterBarSorting: saved?.filterBarSorting === true,
          tableFilterMode: saved?.tableFilterMode === "sql" ? "sql" : "simple",
          editorKeymap: saved?.editorKeymap === "vim" ? "vim" : "default",
          dmlPreviewMode: normalizeDmlPreviewMode(saved?.dmlPreviewMode),
          updateChannel: saved?.updateChannel === "canary" ? "canary" : "stable",
          collectCellEdits:
            saved?.collectCellEdits === "off" || saved?.collectCellEdits === "always"
              ? saved.collectCellEdits
              : "production",
        });
      },
    },
  ),
);

syncAcrossWindows("l8db.settings", () => void useSettingsStore.persist.rehydrate());
