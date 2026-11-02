import { create, type StateCreator } from "zustand";
import type { OrganizationPolicy } from "@/lib/db/organization";

interface OrganizationState {
  policy: OrganizationPolicy | null;
  error: string | null;
}

export const useOrganizationStore = create<OrganizationState>(() => ({
  policy: null,
  error: null,
}));

export function lockedSetting(key: string): boolean {
  const policy = useOrganizationStore.getState().policy;
  return policy?.managed === true && policy.settings[key] != null;
}

export function applyOrganizationSettings<T>(value: T): T {
  const settings = useOrganizationStore.getState().policy?.settings;
  if (!settings) return value;
  const locked = Object.fromEntries(Object.entries(settings).filter(([, value]) => value != null));
  return Object.keys(locked).length ? { ...value, ...locked } : value;
}

export function withOrganizationSettings<T>(initializer: StateCreator<T>): StateCreator<T> {
  return (set, get, api) => {
    const protect = (write: typeof set): typeof set =>
      ((partial: T | Partial<T> | ((state: T) => T | Partial<T>), replace?: boolean) => {
        const next = (state: T) =>
          applyOrganizationSettings(
            typeof partial === "function"
              ? (partial as (state: T) => T | Partial<T>)(state)
              : partial,
          );
        if (replace) write(next as (state: T) => T, true);
        else write(next, false);
      }) as typeof set;
    api.setState = protect(api.setState);
    return applyOrganizationSettings(initializer(protect(set), get, api));
  };
}
