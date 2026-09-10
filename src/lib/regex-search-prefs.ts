import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RegexSearchScope = "grid" | "tabs" | "source" | "sidebar";

interface RegexSearchPrefsState {
  scopes: Record<RegexSearchScope, boolean>;
  setRegexEnabled: (scope: RegexSearchScope, enabled: boolean) => void;
  toggleRegex: (scope: RegexSearchScope) => void;
}

export const useRegexSearchPrefs = create<RegexSearchPrefsState>()(
  persist(
    (set) => ({
      scopes: { grid: false, tabs: false, source: false, sidebar: false },
      setRegexEnabled: (scope, enabled) =>
        set((state) => ({ scopes: { ...state.scopes, [scope]: enabled } })),
      toggleRegex: (scope) =>
        set((state) => ({ scopes: { ...state.scopes, [scope]: !state.scopes[scope] } })),
    }),
    { name: "l8db.regex-search" },
  ),
);

export function useRegexEnabled(scope: RegexSearchScope): boolean {
  return useRegexSearchPrefs((state) => state.scopes[scope] ?? false);
}
