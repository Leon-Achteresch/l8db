import { temporal } from "zundo";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createBufferedJsonStorage } from "@/lib/buffered-storage";
import { groupRapidEdits, HISTORY_LIMIT } from "@/lib/undo-history";
import { syncAcrossWindows } from "@/lib/window-sync";
import type { Dashboard, Dataset } from "./model";
import { createId } from "./sql";

interface DashboardsState {
  dashboards: Dashboard[];
  active: Record<string, string>;
  add: (connectionId: string, database: string | null, name?: string) => string;
  update: (id: string, patch: Partial<Dashboard> | ((d: Dashboard) => Partial<Dashboard>)) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => string;
  setActive: (connectionId: string, id: string) => void;
  importDashboard: (
    dashboard: Partial<Dashboard>,
    connectionId: string,
    database: string | null,
  ) => string;
}

type History = Pick<DashboardsState, "dashboards">;

const VOLATILE = [
  "locked",
  "refreshSec",
  "filePath",
  "fileStamp",
  "mcpId",
  "mcpStamp",
  "sharedId",
] as const;

type Volatile = Pick<Dashboard, (typeof VOLATILE)[number]>;

function volatileOf(dashboard: Dashboard): Volatile {
  return Object.fromEntries(VOLATILE.map((key) => [key, dashboard[key]])) as Volatile;
}

function editableContent(state: History): string {
  return JSON.stringify(
    state.dashboards.map((dashboard) => {
      const content: Partial<Dashboard> = { ...dashboard };
      for (const key of VOLATILE) delete content[key];
      return content;
    }),
  );
}

const STORAGE_KEY = "l8db-dashboards";

let syncedDashboards = new Map<string, string>();
let unflushed = false;
let adopting = false;

function dashboardsOf(value: string | null): Dashboard[] | undefined {
  try {
    const dashboards = (JSON.parse(value ?? "null") as { state?: { dashboards?: unknown } } | null)
      ?.state?.dashboards;
    return Array.isArray(dashboards) ? (dashboards as Dashboard[]) : undefined;
  } catch {
    return undefined;
  }
}

function fingerprints(dashboards: Dashboard[]): Map<string, string> {
  return new Map(dashboards.map((dashboard) => [dashboard.id, JSON.stringify(dashboard)]));
}

function rememberSynced(value: string | null): void {
  const dashboards = dashboardsOf(value);
  if (dashboards) syncedDashboards = fingerprints(dashboards);
}

const trackedLocalStorage = {
  getItem: (key: string) => {
    const value = window.localStorage.getItem(key);
    if (key === STORAGE_KEY) rememberSynced(value);
    return value;
  },
  setItem: (key: string, value: string) => {
    window.localStorage.setItem(key, value);
    if (key !== STORAGE_KEY) return;
    unflushed = false;
    rememberSynced(value);
  },
  removeItem: (key: string) => window.localStorage.removeItem(key),
};

const bufferedStorage = createBufferedJsonStorage(() => trackedLocalStorage);

const dashboardsStorage: typeof bufferedStorage = {
  ...bufferedStorage,
  setItem: (key, value) => {
    if (adopting && !unflushed) return;
    unflushed = true;
    return bufferedStorage.setItem(key, value);
  },
};

export const useDashboardsStore = create<DashboardsState>()(
  persist(
    temporal(
      (set, get) => ({
        dashboards: [],
        active: {},
        add: (connectionId, database, name) => {
          const id = createId();
          const count = get().dashboards.filter((d) => d.connectionId === connectionId).length;
          set((s) => ({
            dashboards: [
              ...s.dashboards,
              {
                id,
                connectionId,
                database,
                name: name ?? `Dashboard ${count + 1}`,
                datasets: [],
                widgets: [],
                refreshSec: 0,
                locked: false,
                createdAt: Date.now(),
              },
            ],
            active: { ...s.active, [connectionId]: id },
          }));
          return id;
        },
        update: (id, patch) =>
          set((s) => ({
            dashboards: s.dashboards.map((d) =>
              d.id === id ? { ...d, ...(typeof patch === "function" ? patch(d) : patch) } : d,
            ),
          })),
        remove: (id) =>
          set((s) => {
            const gone = s.dashboards.find((d) => d.id === id);
            const dashboards = s.dashboards.filter((d) => d.id !== id);
            const active = { ...s.active };
            if (gone && active[gone.connectionId] === id) {
              const next = dashboards.find((d) => d.connectionId === gone.connectionId);
              if (next) active[gone.connectionId] = next.id;
              else delete active[gone.connectionId];
            }
            return { dashboards, active };
          }),
        duplicate: (id) => {
          const source = get().dashboards.find((d) => d.id === id);
          if (!source) return id;
          return get().importDashboard(
            { ...source, mcpId: null, sharedId: null, name: `${source.name} (Kopie)` },
            source.connectionId,
            source.database,
          );
        },
        setActive: (connectionId, id) =>
          set((s) => ({ active: { ...s.active, [connectionId]: id } })),
        importDashboard: (dashboard, connectionId, database) => {
          const existing = get().dashboards.find(
            (d) =>
              d.connectionId === connectionId &&
              ((dashboard.filePath && d.filePath === dashboard.filePath) ||
                (dashboard.sharedId &&
                  d.sharedId === dashboard.sharedId &&
                  d.database === database)),
          );
          if (existing) {
            set((s) => ({
              dashboards: s.dashboards.map((d) =>
                d.id === existing.id ? { ...d, ...dashboard, id: d.id, connectionId, database } : d,
              ),
              active: { ...s.active, [connectionId]: existing.id },
            }));
            return existing.id;
          }
          const id = createId();
          set((s) => ({
            dashboards: [
              ...s.dashboards,
              {
                filePath: null,
                fileStamp: null,
                ...dashboard,
                id,
                connectionId,
                database,
                createdAt: Date.now(),
              } as Dashboard,
            ],
            active: { ...s.active, [connectionId]: id },
          }));
          return id;
        },
      }),
      {
        limit: HISTORY_LIMIT,
        partialize: (state): History => ({ dashboards: state.dashboards }),
        equality: (past, current) => editableContent(past) === editableContent(current),
        handleSet: groupRapidEdits,
      },
    ),
    {
      name: STORAGE_KEY,
      version: 2,
      migrate: (state) => {
        const persisted = state as { dashboards?: Dashboard[] };
        for (const dashboard of persisted.dashboards ?? [])
          for (const dataset of dashboard.datasets ?? []) {
            const legacy = dataset as Dataset & { flow?: unknown };
            if (legacy.flow !== undefined || (dataset.mode as string) === "flow") {
              delete legacy.flow;
              if ((dataset.mode as string) !== "expert") dataset.mode = "simple";
            }
          }
        return state;
      },
      storage: dashboardsStorage,
    },
  ),
);

function travel(direction: "undo" | "redo"): void {
  const kept = new Map(
    useDashboardsStore
      .getState()
      .dashboards.map((dashboard) => [dashboard.id, volatileOf(dashboard)]),
  );
  const history = useDashboardsStore.temporal.getState();
  history.pause();
  history[direction]();
  useDashboardsStore.setState((state) => ({
    dashboards: state.dashboards.map((dashboard) => {
      const current = kept.get(dashboard.id);
      return current ? { ...dashboard, ...current } : dashboard;
    }),
  }));
  history.resume();
}

export function undoDashboards(): void {
  travel("undo");
}

export function redoDashboards(): void {
  travel("redo");
}

export function clearDashboardHistory(): void {
  useDashboardsStore.temporal.getState().clear();
}

export function withoutDashboardHistory(apply: () => void): void {
  const history = useDashboardsStore.temporal.getState();
  history.pause();
  try {
    apply();
  } finally {
    history.resume();
    history.clear();
  }
}

function mergeDashboards(
  synced: ReadonlyMap<string, string>,
  local: Dashboard[],
  incoming: Dashboard[],
): Dashboard[] {
  const changedLocally = (dashboard: Dashboard) =>
    synced.get(dashboard.id) !== JSON.stringify(dashboard);
  const localById = new Map(local.map((dashboard) => [dashboard.id, dashboard]));
  const incomingIds = new Set(incoming.map((dashboard) => dashboard.id));
  const merged: Dashboard[] = [];
  for (const theirs of incoming) {
    const mine = localById.get(theirs.id);
    if (mine) merged.push(changedLocally(mine) ? mine : theirs);
    else if (synced.get(theirs.id) !== JSON.stringify(theirs)) merged.push(theirs);
  }
  for (const mine of local)
    if (!incomingIds.has(mine.id) && changedLocally(mine)) merged.push(mine);
  return merged;
}

function applyDashboardsFromOtherWindow(value: string | null): void {
  const incoming = dashboardsOf(value);
  if (!incoming) return;
  const state = useDashboardsStore.getState();
  const merged = mergeDashboards(syncedDashboards, state.dashboards, incoming);
  syncedDashboards = fingerprints(incoming);
  const mergedJson = JSON.stringify(merged);
  const settled = mergedJson === JSON.stringify(incoming);
  if (mergedJson !== JSON.stringify(state.dashboards)) {
    adopting = settled;
    try {
      withoutDashboardHistory(() => useDashboardsStore.setState({ dashboards: merged }));
    } finally {
      adopting = false;
    }
  } else if (!settled) {
    unflushed = true;
    void bufferedStorage.setItem(STORAGE_KEY, {
      state: { ...state },
      version: useDashboardsStore.persist.getOptions().version ?? 0,
    });
  }
}

syncAcrossWindows(STORAGE_KEY, applyDashboardsFromOtherWindow);
