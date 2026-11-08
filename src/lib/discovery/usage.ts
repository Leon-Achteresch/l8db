import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { useSettingsStore } from "@/lib/settings";
import { syncAcrossWindows } from "@/lib/window-sync";
import { FEATURE_CATALOG, featureById } from "./catalog";
import type { FeatureEntry } from "./types";

export {
  beginQueryEvent,
  type FeatureEvent,
  type FeatureEventData,
  hashFeatureValue,
  onFeatureEvent,
  recordFeatureEvent,
} from "./events";

export const USAGE_STORAGE_KEY = "l8db.discovery.usage";
export const DISCOVERY_STORAGE_PREFIX = "l8db.discovery.";
export const MAX_EXTRA_FEATURES = 256;
const CLICK_ROUTE_WINDOW_MS = 2000;
const FEATURE_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;

export interface FeatureUsageEntry {
  count: number;
  first: number;
  last: number;
}

export type FeatureUsage = Record<string, FeatureUsageEntry>;

interface UsageState {
  usage: FeatureUsage;
  extra: number;
  record: (id: string, now?: number) => FeatureUsageEntry | null;
  reset: () => void;
}

type UsedListener = (id: string, entry: FeatureUsageEntry) => void;

const usedListeners = new Set<UsedListener>();
const resetListeners = new Set<() => void>();

function countExtra(usage: FeatureUsage): number {
  let extra = 0;
  for (const id in usage) if (!featureById(id)) extra++;
  return extra;
}

export function pruneFeatureUsage(value: unknown): FeatureUsage {
  const result: FeatureUsage = {};
  if (!value || typeof value !== "object") return result;
  let extra = 0;
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!FEATURE_ID.test(id) || !raw || typeof raw !== "object") continue;
    const { count, first, last } = raw as Partial<FeatureUsageEntry>;
    if (!Number.isFinite(count) || !Number.isFinite(first) || !Number.isFinite(last)) continue;
    if (!featureById(id) && ++extra > MAX_EXTRA_FEATURES) continue;
    result[id] = {
      count: Math.max(1, Math.floor(count as number)),
      first: first as number,
      last: last as number,
    };
  }
  return result;
}

export const useFeatureUsageStore = create<UsageState>()(
  persist(
    (set, get) => ({
      usage: {},
      extra: 0,
      record: (id, now = Date.now()) => {
        if (!FEATURE_ID.test(id)) return null;
        const { usage, extra } = get();
        const current = usage[id];
        const known = current !== undefined || featureById(id) !== undefined;
        if (!known && extra >= MAX_EXTRA_FEATURES) return null;
        const entry = current
          ? { count: current.count + 1, first: current.first, last: now }
          : { count: 1, first: now, last: now };
        set({
          usage: { ...usage, [id]: entry },
          extra: current || featureById(id) ? extra : extra + 1,
        });
        return entry;
      },
      reset: () => set({ usage: {}, extra: 0 }),
    }),
    {
      name: USAGE_STORAGE_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ usage: state.usage }),
      merge: (persisted, current) => {
        const usage = pruneFeatureUsage((persisted as { usage?: unknown } | undefined)?.usage);
        return { ...current, usage, extra: countExtra(usage) };
      },
    },
  ),
);

syncAcrossWindows(USAGE_STORAGE_KEY, () => void useFeatureUsageStore.persist.rehydrate());

function trackingEnabled(): boolean {
  return useSettingsStore.getState().discovery?.enabled !== false;
}

export function recordFeatureUse(id: string, now = Date.now()): boolean {
  if (!trackingEnabled()) return false;
  const entry = useFeatureUsageStore.getState().record(id, now);
  if (!entry) return false;
  for (const listener of [...usedListeners]) {
    try {
      listener(id, entry);
    } catch (error) {
      console.warn(`Discovery-Nutzung ${id} fehlgeschlagen.`, error);
    }
  }
  return true;
}

export function featureUsed(id: string): boolean {
  return useFeatureUsageStore.getState().usage[id] !== undefined;
}

export function featureUsage(id: string): FeatureUsageEntry | undefined {
  return useFeatureUsageStore.getState().usage[id];
}

export function useFeatureUsage(): FeatureUsage {
  return useFeatureUsageStore((state) => state.usage);
}

export function onFeatureUsed(listener: UsedListener): () => void {
  usedListeners.add(listener);
  return () => {
    usedListeners.delete(listener);
  };
}

export function onDiscoveryReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
}

export function resetDiscoveryProgress(): void {
  useFeatureUsageStore.getState().reset();
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (key?.startsWith(DISCOVERY_STORAGE_PREFIX) && key !== USAGE_STORAGE_KEY) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch (error) {
    console.warn("Discovery-Fortschritt konnte nicht vollständig gelöscht werden.", error);
  }
  for (const listener of [...resetListeners]) {
    try {
      listener();
    } catch (error) {
      console.warn("Discovery-Zurücksetzen fehlgeschlagen.", error);
    }
  }
}

function routeIndex(entries: readonly FeatureEntry[]) {
  const index = new Map<string, { id: string; params: [string, string][] }[]>();
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.route || seen.has(entry.route)) continue;
    seen.add(entry.route);
    const [path, query = ""] = entry.route.split("?");
    const list = index.get(path) ?? [];
    list.push({ id: entry.id, params: [...new URLSearchParams(query).entries()] });
    index.set(path, list);
  }
  for (const list of index.values()) list.sort((a, b) => b.params.length - a.params.length);
  return index;
}

let cachedIndex: ReturnType<typeof routeIndex> | null = null;

export function featureForLocation(
  pathname: string,
  search: Readonly<Record<string, unknown>> = {},
  entries: readonly FeatureEntry[] = FEATURE_CATALOG,
): string | null {
  if (entries === FEATURE_CATALOG && !cachedIndex) cachedIndex = routeIndex(entries);
  const index = entries === FEATURE_CATALOG && cachedIndex ? cachedIndex : routeIndex(entries);
  const candidates = index.get(pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname);
  if (!candidates) return null;
  for (const candidate of candidates) {
    if (candidate.params.every(([key, value]) => String(search[key] ?? "") === value))
      return candidate.id;
  }
  return null;
}

export interface UsageRouter {
  subscribe: (event: "onResolved", listener: () => void) => () => void;
  state: { location: { pathname: string; search: unknown } };
}

export function anchorFeatureOf(target: EventTarget | null): string | null {
  const element =
    target && typeof (target as Element).closest === "function"
      ? (target as Element).closest("[data-feature]")
      : null;
  return element?.getAttribute("data-feature") ?? null;
}

export function installFeatureUsageTracking(router?: UsageRouter): () => void {
  let clicked = { id: "", at: 0 };
  const onClick = (event: Event) => {
    const id = anchorFeatureOf(event.target);
    if (!id) return;
    clicked = { id, at: Date.now() };
    recordFeatureUse(id);
  };
  document.addEventListener("click", onClick, { capture: true, passive: true });
  let lastLocation = "";
  const onRoute = () => {
    if (!router) return;
    const { pathname, search } = router.state.location;
    const id = featureForLocation(
      pathname,
      (search && typeof search === "object" ? search : {}) as Record<string, unknown>,
    );
    const key = id ?? "";
    if (key === lastLocation) return;
    lastLocation = key;
    if (id && !(clicked.id === id && Date.now() - clicked.at < CLICK_ROUTE_WINDOW_MS))
      recordFeatureUse(id);
  };
  const unsubscribe = router?.subscribe("onResolved", onRoute);
  onRoute();
  return () => {
    document.removeEventListener("click", onClick, { capture: true });
    unsubscribe?.();
  };
}
