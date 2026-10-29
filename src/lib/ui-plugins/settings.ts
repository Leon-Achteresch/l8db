import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export type UiPluginOptionValue = string | number | boolean;

export type InstalledUiPlugin = {
  file: string;
  version: string;
  sha256: string;
};

interface UiPluginSettingsState {
  disabled: string[];
  options: Record<string, Record<string, UiPluginOptionValue>>;
  httpGrants: Record<string, string[]>;
  installed: Record<string, InstalledUiPlugin>;
  setEnabled: (id: string, enabled: boolean) => void;
  setOption: (id: string, key: string, value: UiPluginOptionValue) => void;
  resetOptions: (id: string) => void;
  grantHttp: (id: string, patterns: string[]) => void;
  revokeHttp: (id: string) => void;
  markInstalled: (id: string, entry: InstalledUiPlugin) => void;
  forgetInstalled: (id: string) => void;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const useUiPluginSettings = create<UiPluginSettingsState>()(
  persist(
    (set) => ({
      disabled: [],
      options: {},
      httpGrants: {},
      installed: {},
      setEnabled: (id, enabled) =>
        set((state) => ({
          disabled: enabled
            ? state.disabled.filter((entry) => entry !== id)
            : state.disabled.includes(id)
              ? state.disabled
              : [...state.disabled, id],
        })),
      setOption: (id, key, value) =>
        set((state) => ({
          options: { ...state.options, [id]: { ...state.options[id], [key]: value } },
        })),
      resetOptions: (id) => set((state) => ({ options: without(state.options, id) })),
      grantHttp: (id, patterns) =>
        set((state) => ({ httpGrants: { ...state.httpGrants, [id]: [...new Set(patterns)] } })),
      revokeHttp: (id) => set((state) => ({ httpGrants: without(state.httpGrants, id) })),
      markInstalled: (id, entry) =>
        set((state) => ({ installed: { ...state.installed, [id]: entry } })),
      forgetInstalled: (id) => set((state) => ({ installed: without(state.installed, id) })),
    }),
    {
      name: "l8db.ui-plugins",
      version: 1,
      partialize: (state) => ({
        disabled: state.disabled,
        options: state.options,
        httpGrants: state.httpGrants,
        installed: state.installed,
      }),
    },
  ),
);

syncAcrossWindows("l8db.ui-plugins", () => void useUiPluginSettings.persist.rehydrate());
