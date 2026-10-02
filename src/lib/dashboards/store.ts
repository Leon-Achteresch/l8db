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

const VOLATILE = ["locked", "refreshSec", "filePath", "fileStamp", "mcpId", "mcpStamp"] as const;

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
            { ...source, mcpId: null, name: `${source.name} (Kopie)` },
            source.connectionId,
            source.database,
          );
        },
        setActive: (connectionId, id) =>
          set((s) => ({ active: { ...s.active, [connectionId]: id } })),
        importDashboard: (dashboard, connectionId, database) => {
          const existing = dashboard.filePath
            ? get().dashboards.find(
                (d) => d.filePath === dashboard.filePath && d.connectionId === connectionId,
              )
            : undefined;
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
      name: "l8db-dashboards",
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
      storage: createBufferedJsonStorage(() => window.localStorage),
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

function applyDashboardsFromOtherWindow(value: string | null): void {
  let dashboards: unknown;
  try {
    dashboards = (JSON.parse(value ?? "null") as { state?: { dashboards?: unknown } } | null)?.state
      ?.dashboards;
  } catch {
    return;
  }
  if (!Array.isArray(dashboards)) return;
  if (JSON.stringify(dashboards) === JSON.stringify(useDashboardsStore.getState().dashboards))
    return;
  withoutDashboardHistory(() =>
    useDashboardsStore.setState({ dashboards: dashboards as Dashboard[] }),
  );
}

syncAcrossWindows("l8db-dashboards", applyDashboardsFromOtherWindow);
