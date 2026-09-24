import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { HostGroupRule } from "@/lib/connection-groups";
import { closeSshTunnel } from "@/lib/db";
import { deleteSecret, loadSecret, scrubUrlPassword, storeSecret } from "@/lib/secrets";
import type { ConnectionInput, SavedConnection } from "./types";

interface ConnectionsState {
  connections: SavedConnection[];
  activeId: string | null;
  favoriteServerKeys: string[];
  serverOrder: string[];
  collapsedServerKeys: string[];
  hostGroupRules: HostGroupRule[];
  setHostGroupRules: (rules: HostGroupRule[]) => void;
  addConnection: (input: ConnectionInput) => SavedConnection;
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

export const windowConnectionId: string | null =
  typeof window === "undefined"
    ? null
    : new URLSearchParams(window.location?.search ?? "").get("connection");

export const isMainWindow = windowConnectionId === null;

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
      updateConnection: (id, input) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === id ? { ...input, id } : connection,
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
      setActiveId: (id) => set({ activeId: id }),
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
        connections: state.connections,
        activeId: isMainWindow ? state.activeId : readStoredActiveId(),
        favoriteServerKeys: state.favoriteServerKeys,
        serverOrder: state.serverOrder,
        collapsedServerKeys: state.collapsedServerKeys,
        hostGroupRules: state.hostGroupRules,
      }),
    },
  ),
);

if (
  windowConnectionId &&
  useConnectionsStore.getState().connections.some((entry) => entry.id === windowConnectionId)
) {
  useConnectionsStore.setState({ activeId: windowConnectionId });
}
