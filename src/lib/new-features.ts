import { useSyncExternalStore } from "react";
import { version as appVersion } from "../../package.json";

export const NEW_FEATURES = {
  "versioning.overview": "0.8.0",
  "versioning.branches.swimlanes": "0.8.0",
  "versioning.releases.generate": "0.8.0",
  "versioning.targets.customers": "0.8.0",
  "versioning.targets.team": "0.8.0",
  "versioning.seeds": "0.8.0",
  "versioning.tab-view": "0.8.0",
  "table.pagination.keyboard": "0.7.0",
  "query.select-row-limit": "0.7.0",
  "query.analysis.index-advisor": "0.7.0",
  "onboarding.drivers": "0.7.0",
  "settings.about.crash-reports": "0.7.0",
  "settings.about.usage-metrics": "0.7.0",
  "settings.about.open-source-licenses": "0.8.0",
  "connections.baas": "0.7.0",
  "connections.open-window": "0.8.0",
  "baas.supabase": "0.7.0",
  "baas.supabase.project-key-import": "0.7.0",
  "baas.supabase.database": "0.7.0",
  "baas.supabase.storage-upload": "0.7.0",
  "baas.supabase.storage-manage": "0.7.0",
  "baas.supabase.bucket-manage": "0.7.0",
  "baas.supabase.storage-details": "0.7.0",
  "baas.supabase.file-details": "0.7.0",
  "baas.supabase.function-details": "0.7.0",
  "baas.supabase.function-manage": "0.7.0",
  "baas.supabase.auth-details": "0.7.0",
  "baas.supabase.auth-manage": "0.7.0",
  "baas.supabase.backups": "0.7.0",
  "baas.firebase": "0.7.0",
  "baas.firebase.storage": "0.7.0",
  "baas.firebase.storage-upload": "0.7.0",
  "baas.firebase.auth": "0.7.0",
  "baas.firebase.firestore": "0.7.0",
  "baas.firebase.functions": "0.7.0",
  "baas.firebase.hosting": "0.7.0",
  "baas.firebase.hosting-releases": "0.7.0",
  "baas.appwrite": "0.7.0",
  "baas.appwrite.storage-upload": "0.7.0",
  "baas.appwrite.storage-manage": "0.7.0",
  "baas.appwrite.bucket-manage": "0.7.0",
  "baas.appwrite.users-manage": "0.7.0",
  "baas.appwrite.functions-manage": "0.7.0",
  "baas.appwrite.storage-details": "0.7.0",
  "baas.appwrite.function-details": "0.7.0",
  "baas.appwrite.site-details": "0.7.0",
  "baas.appwrite.rows": "0.7.0",
  "baas.appwrite.columns": "0.7.0",
  "baas.pocketbase": "0.7.0",
  "baas.pocketbase.manage": "0.7.0",
  "baas.pocketbase.collection-manage": "0.7.0",
  "baas.pocketbase.auth-manage": "0.7.0",
  "baas.convex": "0.7.0",
  "baas.convex.environment": "0.7.0",
  "baas.file-preview": "0.7.0",
  "settings.data.transfer": "0.7.0",
  "query.transaction.changes": "0.7.0",
  "compare.scroll-sync": "0.7.0",
  "split.pane-tables": "0.8.0",
} as const;

export type NewFeatureId = keyof typeof NEW_FEATURES;

const STORAGE_PREFIX = "l8db.new-feature-seen";

type FeatureStorage = Pick<Storage, "getItem" | "setItem">;

export function featureStorageKey(id: NewFeatureId): string {
  return `${STORAGE_PREFIX}:${NEW_FEATURES[id]}:${id}`;
}

export function hasNewFeatures(
  scope: string | undefined,
  seen: ReadonlySet<NewFeatureId>,
  version = appVersion,
): boolean {
  if (!scope) return false;
  return (Object.entries(NEW_FEATURES) as [NewFeatureId, string][]).some(
    ([id, introducedIn]) =>
      introducedIn === version && !seen.has(id) && (id === scope || id.startsWith(`${scope}.`)),
  );
}

export function createNewFeatureStore(storage: FeatureStorage | null, version = appVersion) {
  const listeners = new Set<() => void>();

  const readSeen = () => {
    const result = new Set<NewFeatureId>();
    if (!storage) return result;
    for (const [id, introducedIn] of Object.entries(NEW_FEATURES) as [NewFeatureId, string][]) {
      if (introducedIn !== version) continue;
      try {
        if (storage.getItem(featureStorageKey(id)) === "1") result.add(id);
      } catch {
        return result;
      }
    }
    return result;
  };

  let snapshot = readSeen();

  const publish = (next: Set<NewFeatureId>) => {
    if (next.size === snapshot.size && [...next].every((id) => snapshot.has(id))) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markSeen: (id: NewFeatureId) => {
      if (NEW_FEATURES[id] !== version || snapshot.has(id)) return;
      try {
        storage?.setItem(featureStorageKey(id), "1");
      } catch {
        publish(new Set([...snapshot, id]));
        return;
      }
      publish(new Set([...snapshot, id]));
    },
    refresh: () => publish(readSeen()),
  };
}

function browserStorage(): FeatureStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const store = createNewFeatureStore(browserStorage());

if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key.startsWith(`${STORAGE_PREFIX}:`)) store.refresh();
  });
}

export function markNewFeatureSeen(id: NewFeatureId): void {
  store.markSeen(id);
}

export function useSeenNewFeatures(): ReadonlySet<NewFeatureId> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useHasNewFeatures(scope: string | undefined): boolean {
  return hasNewFeatures(scope, useSeenNewFeatures());
}
