import { useTheme } from "next-themes";
import { useHotkeysStore } from "@/lib/hotkeys";
import { DEFAULT_HISTORY_LIMIT, useQueryHistoryStore } from "@/lib/query-history";
import { useSettingsStore } from "@/lib/settings";
import {
  isStoredSettingModified,
  resetStoredSetting,
  SETTINGS_CATALOG,
} from "@/lib/settings-catalog";

export function useModifiedSettings() {
  const state = useSettingsStore();
  const { theme, setTheme } = useTheme();
  const historyLimit = useQueryHistoryStore((store) => store.retentionLimit);
  const hotkeys = useHotkeysStore((store) => store.overrides);
  const modified = new Set(
    SETTINGS_CATALOG.filter((setting) => isStoredSettingModified(setting, state)).map(
      (setting) => setting.id,
    ),
  );
  if (theme && theme !== "system") modified.add("theme");
  if (historyLimit !== DEFAULT_HISTORY_LIMIT) modified.add("history-limit");
  if (Object.keys(hotkeys).length > 0) modified.add("hotkeys");

  const reset = (id: string) => {
    if (id === "theme") setTheme("system");
    else if (id === "history-limit")
      useQueryHistoryStore.getState().setRetentionLimit(DEFAULT_HISTORY_LIMIT);
    else if (id === "hotkeys") useHotkeysStore.getState().resetAll();
    else {
      const setting = SETTINGS_CATALOG.find((entry) => entry.id === id);
      if (setting) resetStoredSetting(setting, useSettingsStore.getState());
    }
  };

  return { modified, reset };
}
