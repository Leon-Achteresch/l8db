import { beforeEach, describe, expect, test } from "bun:test";
import { SEARCH_ITEMS } from "../src/features/settings/settings-search-results/search-items";
import { DEFAULT_SETTINGS, useSettingsStore } from "../src/lib/settings";
import {
  isStoredSettingModified,
  resetStoredSetting,
  SETTINGS_BY_ID,
  SETTINGS_CATALOG,
} from "../src/lib/settings-catalog";
import { useSettingsViewState } from "../src/lib/settings-view-state";
import { navigateToTab } from "../src/lib/tab-navigation";

beforeEach(() => {
  useSettingsStore.setState(structuredClone(DEFAULT_SETTINGS));
  useSettingsViewState.setState({ category: "general", query: "", modifiedOnly: false });
});

describe("settings definitions", () => {
  test("every setting has a unique searchable ID, including advanced editor options", () => {
    expect(new Set(SETTINGS_CATALOG.map((setting) => setting.id)).size).toBe(
      SETTINGS_CATALOG.length,
    );
    expect(SEARCH_ITEMS.map((setting) => setting.id)).toEqual(
      SETTINGS_CATALOG.map((setting) => setting.id),
    );
    expect(SEARCH_ITEMS.find((setting) => setting.id === "rulers")?.title).toBe("Lineale");
    expect(SEARCH_ITEMS.find((setting) => setting.id === "density")?.tabLabel).toBe("Darstellung");
    expect(SEARCH_ITEMS.find((setting) => setting.id === "production-auto-rollback")?.tabId).toBe(
      "security",
    );
    expect(SEARCH_ITEMS.find((setting) => setting.id === "local-usage-statistics")).toMatchObject({
      tabId: "statistics",
      tabLabel: "Nutzungsstatistik",
      key: "localUsageStats",
    });
  });

  test("default arrays compare by their contents, while changed values are detected", () => {
    const setting = SETTINGS_BY_ID.get("rulers");
    if (!setting) throw new Error("Missing rulers setting");
    expect(isStoredSettingModified(setting, useSettingsStore.getState())).toBe(false);
    useSettingsStore.getState().setEditorRulers([80, 120]);
    expect(isStoredSettingModified(setting, useSettingsStore.getState())).toBe(true);
    resetStoredSetting(setting, useSettingsStore.getState());
    expect(isStoredSettingModified(setting, useSettingsStore.getState())).toBe(false);
    expect(useSettingsStore.getState().editorRulers).not.toBe(DEFAULT_SETTINGS.editorRulers);
  });

  test("individual resets preserve unrelated preferences and use the existing update dependencies", () => {
    const state = useSettingsStore.getState();
    state.setUiDensity("compact");
    state.setEditorFontSize(18);
    const density = SETTINGS_BY_ID.get("density");
    if (!density) throw new Error("Missing density setting");
    resetStoredSetting(density, useSettingsStore.getState());
    expect(useSettingsStore.getState().uiDensity).toBe("normal");
    expect(useSettingsStore.getState().editorFontSize).toBe(18);
    state.setAutoUpdateInstall(true);
    state.setAutoUpdateCheck(false);
    const updates = SETTINGS_BY_ID.get("updates");
    if (!updates) throw new Error("Missing update setting");
    resetStoredSetting(updates, useSettingsStore.getState());
    expect(useSettingsStore.getState().autoUpdateCheck).toBe(true);
    expect(useSettingsStore.getState().autoUpdateInstall).toBe(false);
  });

  test("local statistics and shared developer metrics have independent consent", () => {
    expect(useSettingsStore.getState().localUsageStats).toBe(false);
    expect(useSettingsStore.getState().usageMetrics).toBe(false);
    useSettingsStore.getState().setLocalUsageStats(true);
    expect(useSettingsStore.getState().usageMetrics).toBe(false);
    useSettingsStore.getState().setUsageMetrics(true);
    const setting = SETTINGS_BY_ID.get("local-usage-statistics");
    if (!setting) throw new Error("Missing local usage setting");
    resetStoredSetting(setting, useSettingsStore.getState());
    expect(useSettingsStore.getState().localUsageStats).toBe(false);
    expect(useSettingsStore.getState().usageMetrics).toBe(true);
  });

  test("every stored preference resolves to an existing setter and restores its default", () => {
    for (const setting of SETTINGS_CATALOG) {
      if (!setting.key) continue;
      const initial = DEFAULT_SETTINGS[setting.key];
      const changed =
        typeof initial === "boolean"
          ? !initial
          : typeof initial === "number"
            ? initial + 1
            : Array.isArray(initial)
              ? [80]
              : "different";
      useSettingsStore.setState({ [setting.key]: changed });
      resetStoredSetting(setting, useSettingsStore.getState());
      expect(useSettingsStore.getState()[setting.key]).toEqual(initial);
    }
    expect(useSettingsStore.getState().productionReadOnly).toBe(true);
    expect(useSettingsStore.getState().productionConfirmCommit).toBe(true);
    expect(useSettingsStore.getState().sshTrustNewHosts).toBe(false);
  });
});

test("settings navigation keeps category and search state until explicitly changed", () => {
  const view = useSettingsViewState.getState();
  view.setCategory("appearance");
  view.setQuery("dichte");
  view.setModifiedOnly(true);
  const navigate = (options: unknown) => options;
  expect(navigateToTab(navigate, { kind: "tool", tool: "settings" })).toEqual({
    to: "/settings",
    search: {},
  });
  expect(useSettingsViewState.getState()).toMatchObject({
    category: "appearance",
    query: "dichte",
    modifiedOnly: true,
  });
  view.setCategory("data");
  expect(useSettingsViewState.getState()).toMatchObject({
    category: "data",
    query: "",
    modifiedOnly: false,
  });
});
