import { useSyncExternalStore } from "react";
import { version as appVersion } from "../../package.json";

export const NEXT_FEATURE_VERSION = "0.14.0";

export const NEW_FEATURES = {
  "settings.general.workspace-tab": "0.9.1",
  "settings.statistics.overview": NEXT_FEATURE_VERSION,
  "workspace.inline-tabs": "0.9.1",
  "workspace.status.branch": "0.9.1",
  "workspace.status.query": "0.9.1",
  "sidebar.rename-inline": "0.9.1",
  "sidebar.object-menu": "0.14.0",
  "sidebar.packages.member-search": "0.14.0",
  "search.fuzzy": "0.10.0",
  "search.commands": "0.9.1",
  "search.commands.new-compare": "0.14.0",
  "ai.workspace": "0.8.0",
  "ai.chat": "0.8.0",
  "ai.chat.approval": "0.8.0",
  "ai.chat.minimize": "0.10.0",
  "ai.providers": "0.8.0",
  "ai.context.connections": "0.8.0",
  "ai.context.skills": "0.8.0",
  "ai.context.mcp": "0.8.0",
  "ai.history": "0.8.0",
  "ai.usage": "0.8.0",
  "ai.onboarding": "0.10.0",
  "ai.ask": "0.10.0",
  "ai.chat.charts": "0.10.0",
  "ai.chat.suggestions": "0.10.0",
  "ai.chat.plus.attachments": "0.10.0",
  "ai.chat.plus.knowledge": "0.10.0",
  "ai.providers.local": "0.10.0",
  "automation.tasks": "0.10.0",
  "automation.schedules": "0.10.0",
  "automation.notifications": "0.10.0",
  "automation.history": "0.10.0",
  "automation.alerts": "0.10.0",
  "automation.background": "0.10.0",
  "mcp.workflows": "0.10.0",
  "mcp.scripts": "0.14.0",
  "health.advisor": "0.10.0",
  "home.customize": "0.8.0",
  "dashboard.visual-builder": "0.8.0",
  "dashboard.chart-gallery": "0.8.0",
  "dashboard.studio": "0.13.0",
  "dashboard.studio.joins": "0.13.0",
  "dashboard.studio.formulas": "0.13.0",
  "dashboard.studio.compare": "0.14.0",
  "dashboard.filters": "0.13.0",
  "dashboard.design.css": NEXT_FEATURE_VERSION,
  "dashboard.database-sharing": NEXT_FEATURE_VERSION,
  "er-diagram.clusters": "0.8.0",
  "er-diagram.text-export": "0.10.0",
  "versioning.overview": "0.8.0",
  "versioning.branches.swimlanes": "0.8.0",
  "versioning.releases.generate": "0.8.0",
  "versioning.targets.customers": "0.8.0",
  "versioning.targets.team": "0.8.0",
  "versioning.seeds": "0.8.0",
  "versioning.tab-view": "0.8.0",
  "versioning.database": "0.10.0",
  "versioning.database.anonymized": "0.10.0",
  "versioning.database.policies": "0.10.0",
  "versioning.reviews": "0.10.0",
  "versioning.delivery": "0.10.0",
  "table.pagination.keyboard": "0.7.0",
  "table.filter.rules": "0.10.0",
  "table.cell.json-editor": "0.10.0",
  "table.extensions.table-json-viewer": "0.10.0",
  "query.select-row-limit": "0.7.0",
  "query.result-view": "0.14.0",
  "query.analysis.index-advisor": "0.7.0",
  "onboarding.drivers": "0.7.0",
  "settings.about.crash-reports": "0.7.0",
  "settings.about.usage-metrics": "0.7.0",
  "settings.about.open-source-licenses": "0.8.0",
  "settings.about.update-channel": "0.14.0",
  "connections.baas": "0.7.0",
  "connections.welcome": "0.14.0",
  "connections.open-window": "0.8.0",
  "connections.editor.command-tunnel": "0.10.0",
  "connections.editor.cloud-auth": "0.10.0",
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
  "settings.general.hide-own-schema": "0.8.0",
  "settings.general.dynamic-island": "0.10.0",
  "settings.general.sidebar-object-nav": "0.10.0",
  "settings.appearance.table-style": "0.14.0",
  "query.transaction.changes": "0.7.0",
  "query.transaction.database-diff": "0.14.0",
  "settings.editor.parameter-hints": NEXT_FEATURE_VERSION,
  "compare.scroll-sync": "0.7.0",
  "compare.draft-toggle": "0.11.0",
  "split.pane-tables": "0.8.0",
  "split.pane-objects": "0.8.0",
  "split.scroll-sync": "0.8.0",
  "settings.extensions.extensions.openbao": "0.8.0",
  "settings.extensions.community-market": "0.8.0",
} as const;

export type NewFeatureId = keyof typeof NEW_FEATURES;

const STORAGE_PREFIX = "l8db.new-feature-seen";

type FeatureStorage = Pick<Storage, "getItem" | "setItem">;

export function featureStorageKey(id: NewFeatureId): string {
  return `${STORAGE_PREFIX}:${NEW_FEATURES[id]}:${id}`;
}

function releaseOf(version: string): string {
  return version.replace(/-.*$/, "");
}

function currentFeatureIds(version: string): NewFeatureId[] {
  return (Object.keys(NEW_FEATURES) as NewFeatureId[]).filter(
    (id) => NEW_FEATURES[id] === releaseOf(version),
  );
}

export function hasNewFeatures(
  scope: string | undefined,
  seen: ReadonlySet<NewFeatureId>,
  version = appVersion,
): boolean {
  if (!scope) return false;
  return (Object.entries(NEW_FEATURES) as [NewFeatureId, string][]).some(
    ([id, introducedIn]) =>
      introducedIn === releaseOf(version) &&
      !seen.has(id) &&
      (id === scope || id.startsWith(`${scope}.`)),
  );
}

export function createNewFeatureStore(storage: FeatureStorage | null, version = appVersion) {
  const release = releaseOf(version);
  const listeners = new Set<() => void>();

  const readSeen = () => {
    const result = new Set<NewFeatureId>();
    if (!storage) return result;
    for (const [id, introducedIn] of Object.entries(NEW_FEATURES) as [NewFeatureId, string][]) {
      if (introducedIn !== release) continue;
      try {
        if (storage.getItem(featureStorageKey(id)) === "1") result.add(id);
      } catch {
        return result;
      }
    }
    return result;
  };

  let snapshot = readSeen();
  let changedAt = 0;

  const publish = (next: Set<NewFeatureId>) => {
    if (next.size === snapshot.size && [...next].every((id) => snapshot.has(id))) return;
    snapshot = next;
    changedAt = Date.now();
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    changedWithin: (ms: number) => Date.now() - changedAt < ms,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    markSeen: (id: NewFeatureId) => {
      if (NEW_FEATURES[id] !== release || snapshot.has(id)) return;
      try {
        storage?.setItem(featureStorageKey(id), "1");
      } catch {
        publish(new Set([...snapshot, id]));
        return;
      }
      publish(new Set([...snapshot, id]));
    },
    markAllSeen: () => {
      const ids = currentFeatureIds(version);
      for (const id of ids) {
        try {
          storage?.setItem(featureStorageKey(id), "1");
        } catch {
          break;
        }
      }
      publish(new Set(ids));
    },
    refresh: () => publish(readSeen()),
  };
}

export function createFeatureDwell(durationMs: number, onDone: (id: NewFeatureId) => void) {
  const elapsed = new Map<NewFeatureId, number>();
  return (id: NewFeatureId) => {
    const startedAt = Date.now();
    const timer = setTimeout(() => onDone(id), Math.max(0, durationMs - (elapsed.get(id) ?? 0)));
    return () => {
      clearTimeout(timer);
      elapsed.set(id, (elapsed.get(id) ?? 0) + Date.now() - startedAt);
    };
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

export function markAllNewFeaturesSeen(): void {
  store.markAllSeen();
}

export function newFeatureJustSeen(): boolean {
  return store.changedWithin(250);
}

export function useSeenNewFeatures(): ReadonlySet<NewFeatureId> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useHasNewFeatures(scope: string | undefined): boolean {
  return hasNewFeatures(scope, useSeenNewFeatures());
}

export function useHasAnyNewFeatures(): boolean {
  const seen = useSeenNewFeatures();
  return currentFeatureIds(appVersion).some((id) => !seen.has(id));
}
