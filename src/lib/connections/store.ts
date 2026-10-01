import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { type HostGroupRule, matchingHostRule } from "@/lib/connection-groups";
import { closeSshTunnel } from "@/lib/db";
import {
  deleteSecret,
  extractUrlPassword,
  injectUrlPassword,
  loadSecret,
  scrubUrlPassword,
  storeSecret,
} from "@/lib/secrets";
import { syncAcrossWindows } from "@/lib/window-sync";
import type { ConnectionInput, SavedConnection } from "./types";

interface ConnectionsState {
  connections: SavedConnection[];
  activeId: string | null;
  recentIds: string[];
  favoriteServerKeys: string[];
  serverOrder: string[];
  collapsedServerKeys: string[];
  hostGroupRules: HostGroupRule[];
  setHostGroupRules: (rules: HostGroupRule[]) => void;
  addConnection: (input: ConnectionInput) => SavedConnection;
  addTemporaryConnection: (input: ConnectionInput) => SavedConnection;
  saveTemporaryConnection: (id: string) => void;
  updateConnection: (id: string, input: ConnectionInput) => void;
  removeConnection: (id: string) => void;
  duplicateConnection: (id: string) => SavedConnection | null;
  toggleFavorite: (id: string) => void;
  addImported: (connections: SavedConnection[]) => void;
  setActiveId: (id: string | null) => void;
  toggleServerFavorite: (key: string) => void;
  setServerOrder: (keys: string[]) => void;
  setServerCollapsed: (key: string, collapsed: boolean) => void;
}

export function createConnectionId(): string {
  return createId();
}

const windowParams = new URLSearchParams(
  typeof window === "undefined" ? "" : (window.location?.search ?? ""),
);

export const windowConnectionId: string | null = windowParams.get("connection");

export const isMainWindow = windowConnectionId === null && !windowParams.has("window");

export const RECENT_CONNECTION_LIMIT = 10;

export const NETWORK_SECRET_SUFFIXES = [":ssh", ":ssh-jumps", ":proxy"];

function readStoredActiveId(): string | null {
  try {
    const raw = window.localStorage.getItem("l8db.connections");
    if (!raw) return null;
    return (JSON.parse(raw) as { state?: { activeId?: string | null } }).state?.activeId ?? null;
  } catch {
    return null;
  }
}

export function restorableActiveId(
  state: Pick<ConnectionsState, "activeId" | "connections" | "hostGroupRules">,
): string | null {
  const active = state.connections.find((connection) => connection.id === state.activeId);
  if (!active || active.temporary || active.environment === "production") return null;
  if (active.environment) return active.id;
  try {
    const rule = matchingHostRule(
      active,
      state.hostGroupRules.filter((entry) => entry.environment),
    );
    if (rule?.environment === "production") return null;
  } catch {
    return null;
  }
  return active.id;
}

export function mergeWindowSync(
  saved: Pick<ConnectionsState, "connections">,
  current: Pick<ConnectionsState, "connections" | "activeId">,
): Pick<ConnectionsState, "connections" | "activeId"> {
  const live = new Map(current.connections.map((connection) => [connection.id, connection]));
  const connections = [
    ...saved.connections.map((connection) => {
      const known = live.get(connection.id);
      return known && scrubUrlPassword(known.connectionString) === connection.connectionString
        ? { ...connection, connectionString: known.connectionString, tunnelPort: known.tunnelPort }
        : connection;
    }),
    ...current.connections.filter(
      (connection) =>
        connection.temporary && !saved.connections.some((entry) => entry.id === connection.id),
    ),
  ];
  return {
    connections,
    activeId: connections.some((connection) => connection.id === current.activeId)
      ? current.activeId
      : null,
  };
}

let syncingWindows = false;

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

const scrubbingStorage: StateStorage = {
  getItem: (key) => window.localStorage.getItem(key),
  setItem: (key, value) => {
    try {
      const parsed = JSON.parse(value) as {
        state?: { connections?: SavedConnection[] };
      };
      const connections = parsed?.state?.connections;
      if (Array.isArray(connections)) {
        for (const connection of connections) {
          if (typeof connection?.connectionString === "string") {
            connection.connectionString = scrubUrlPassword(connection.connectionString);
          }
          if ("tunnelPort" in connection) {
            connection.tunnelPort = null;
          }
        }
      }
      window.localStorage.setItem(key, JSON.stringify(parsed));
    } catch {
      throw new Error("Verbindungen konnten nicht sicher gespeichert werden.");
    }
  },
  removeItem: (key) => window.localStorage.removeItem(key),
};

export const useConnectionsStore = create<ConnectionsState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeId: null,
      recentIds: [],
      favoriteServerKeys: [],
      serverOrder: [],
      collapsedServerKeys: [],
      hostGroupRules: [],
      setHostGroupRules: (rules) => set({ hostGroupRules: rules }),
      addConnection: (input) => {
        const connection: SavedConnection = { ...input, id: createId() };
        set((state) => ({
          connections: [...state.connections, connection],
        }));
        return connection;
      },
      addTemporaryConnection: (input) => {
        const existing = get().connections.find(
          (connection) =>
            connection.kind === input.kind &&
            connection.connectionString === input.connectionString,
        );
        if (existing) return existing;
        const connection: SavedConnection = { ...input, id: createId(), temporary: true };
        set((state) => ({ connections: [...state.connections, connection] }));
        return connection;
      },
      saveTemporaryConnection: (id) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === id ? { ...connection, temporary: false } : connection,
          ),
        })),
      updateConnection: (id, input) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id !== id
              ? connection
              : connection.temporary
                ? { temporary: true, ...input, id }
                : { ...input, id },
          ),
        })),
      removeConnection: (id) => {
        void deleteSecret(id).catch(() => undefined);
        for (const suffix of NETWORK_SECRET_SUFFIXES) {
          void deleteSecret(`${id}${suffix}`).catch(() => undefined);
        }
        void closeSshTunnel(id).catch(() => undefined);
        set((state) => ({
          connections: state.connections.filter((connection) => connection.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        }));
      },
      duplicateConnection: (id) => {
        const source = get().connections.find((connection) => connection.id === id);
        if (!source) return null;
        const copy: SavedConnection = {
          ...source,
          id: createId(),
          name: `${source.name} (Kopie)`,
          favorite: false,
          vault: false,
        };
        for (const suffix of ["", ...NETWORK_SECRET_SUFFIXES]) {
          void loadSecret(`${id}${suffix}`)
            .then((secret) => (secret ? storeSecret(`${copy.id}${suffix}`, secret) : undefined))
            .catch(() => undefined);
        }
        set((state) => ({ connections: [...state.connections, copy] }));
        return copy;
      },
      toggleFavorite: (id) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === id ? { ...connection, favorite: !connection.favorite } : connection,
          ),
        })),
      addImported: (imported) =>
        set((state) => {
          const known = new Set(state.connections.map((connection) => connection.id));
          const fresh = imported.filter((connection) => !known.has(connection.id));
          return { connections: [...state.connections, ...fresh] };
        }),
      setActiveId: (id) =>
        set((state) => ({
          activeId: id,
          recentIds: id
            ? [id, ...state.recentIds.filter((entry) => entry !== id)].slice(
                0,
                RECENT_CONNECTION_LIMIT,
              )
            : state.recentIds,
        })),
      toggleServerFavorite: (key) =>
        set((state) => ({
          favoriteServerKeys: state.favoriteServerKeys.includes(key)
            ? state.favoriteServerKeys.filter((entry) => entry !== key)
            : [...state.favoriteServerKeys, key],
        })),
      setServerOrder: (keys) => set({ serverOrder: keys }),
      setServerCollapsed: (key, collapsed) =>
        set((state) => ({
          collapsedServerKeys: collapsed
            ? [...new Set([...state.collapsedServerKeys, key])]
            : state.collapsedServerKeys.filter((entry) => entry !== key),
        })),
    }),
    {
      name: "l8db.connections",
      storage: createJSONStorage(() => scrubbingStorage),
      partialize: (state) => ({
        connections: state.connections.filter((connection) => !connection.temporary),
        activeId: isMainWindow ? restorableActiveId(state) : readStoredActiveId(),
        recentIds: state.recentIds,
        favoriteServerKeys: state.favoriteServerKeys,
        serverOrder: state.serverOrder,
        collapsedServerKeys: state.collapsedServerKeys,
        hostGroupRules: state.hostGroupRules,
      }),
      merge: (persisted, current) => {
        const saved = persisted as Partial<ConnectionsState> | undefined;
        const merged = { ...current, ...saved };
        if (syncingWindows) return { ...merged, ...mergeWindowSync(merged, current) };
        return {
          ...merged,
          activeId: isMainWindow ? restorableActiveId(merged) : null,
        };
      },
    },
  ),
);

async function loadSyncedSecrets(previous: SavedConnection[]): Promise<void> {
  const known = new Map(previous.map((connection) => [connection.id, connection.connectionString]));
  const missing = useConnectionsStore
    .getState()
    .connections.filter(
      (connection) =>
        known.get(connection.id) !== connection.connectionString &&
        extractUrlPassword(connection.connectionString) === null,
    );
  for (const connection of missing) {
    const secret = await loadSecret(connection.id).catch(() => null);
    if (!secret) continue;
    useConnectionsStore.setState((state) => ({
      connections: state.connections.map((entry) =>
        entry.id === connection.id && entry.connectionString === connection.connectionString
          ? { ...entry, connectionString: injectUrlPassword(entry.connectionString, secret) }
          : entry,
      ),
    }));
  }
}

export function syncConnectionsFromStorage(): void {
  const previous = useConnectionsStore.getState().connections;
  syncingWindows = true;
  let rehydrated: Promise<void> | void;
  try {
    rehydrated = useConnectionsStore.persist.rehydrate();
  } finally {
    syncingWindows = false;
  }
  void Promise.resolve(rehydrated).then(() => loadSyncedSecrets(previous));
}

syncAcrossWindows("l8db.connections", syncConnectionsFromStorage);
