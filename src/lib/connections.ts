import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import { sslModeFromUrl } from "@/lib/connection-url";
import {
  closeSshTunnel,
  type DatabaseKind,
  registerReadOnlyResolver,
  type SslMode,
} from "@/lib/db";
import { capabilitiesFor } from "@/lib/providers";
import {
  deleteSecret,
  extractUrlPassword,
  injectUrlPassword,
  loadSecret,
  scrubUrlPassword,
  storeSecret,
} from "@/lib/secrets";

export interface ConnectionTag {
  name: string;
  color: string;
}

export const TAG_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#a855f7",
  "#ec4899",
  "#eab308",
  "#ef4444",
  "#64748b",
  "#06b6d4",
];

export interface ConnectionColor {
  value: string;
  label: string;
}

export const CONNECTION_COLORS: ConnectionColor[] = [
  { value: "#ef4444", label: "Rot" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Gelb" },
  { value: "#22c55e", label: "Grün" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#a855f7", label: "Violett" },
  { value: "#64748b", label: "Grau" },
];

export function connectionColorLabel(color: string | null | undefined): string | null {
  if (!color) return null;
  return CONNECTION_COLORS.find((entry) => entry.value === color)?.label ?? color;
}

export type SshAuth = "password" | "key";

export interface SshConnection {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  keyFile: string;
  remoteHost: string;
  remotePort: number;
}

export interface SavedConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  sslMode: SslMode;
  ssh?: SshConnection | null;
  tunnelPort?: number | null;
  tags?: ConnectionTag[];
  favorite?: boolean;
  color?: string | null;
  readOnly?: boolean;
}

export type ConnectionInput = Omit<SavedConnection, "id">;

interface ConnectionsState {
  connections: SavedConnection[];
  activeId: string | null;
  addConnection: (input: ConnectionInput) => SavedConnection;
  updateConnection: (id: string, input: ConnectionInput) => void;
  removeConnection: (id: string) => void;
  toggleFavorite: (id: string) => void;
  addImported: (connections: SavedConnection[]) => void;
  setActiveId: (id: string | null) => void;
}

export function createConnectionId(): string {
  return createId();
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
    (set) => ({
      connections: [],
      activeId: null,
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
        void deleteSecret(`${id}:ssh`).catch(() => undefined);
        void closeSshTunnel(id).catch(() => undefined);
        set((state) => ({
          connections: state.connections.filter((connection) => connection.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        }));
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
    }),
    {
      name: "l8db.connections",
      storage: createJSONStorage(() => scrubbingStorage),
      partialize: (state) => ({
        connections: state.connections,
        activeId: state.activeId,
      }),
    },
  ),
);

let secretsInitialized = false;

export async function initConnectionSecrets(): Promise<void> {
  if (secretsInitialized) return;
  secretsInitialized = true;
  const { connections } = useConnectionsStore.getState();
  if (connections.length === 0) return;
  let changed = false;
  const next = await Promise.all(
    connections.map(async (connection) => {
      const withDefaults: SavedConnection = {
        ssh: null,
        ...connection,
        sslMode: connection.sslMode ?? sslModeFromUrl(connection.connectionString),
      };
      if (withDefaults.sslMode !== connection.sslMode || withDefaults.ssh !== connection.ssh) {
        changed = true;
      }
      const inline = extractUrlPassword(withDefaults.connectionString);
      if (inline) {
        changed = true;
        try {
          await storeSecret(withDefaults.id, inline);
        } catch {
          return withDefaults;
        }
        return withDefaults;
      }
      try {
        const saved = await loadSecret(withDefaults.id);
        if (saved) {
          changed = true;
          return {
            ...withDefaults,
            connectionString: injectUrlPassword(withDefaults.connectionString, saved),
          };
        }
      } catch {
        return withDefaults;
      }
      return withDefaults;
    }),
  );
  if (changed) {
    useConnectionsStore.setState({ connections: next });
  }
}

export function isReadOnlyConnection(
  connection: Pick<SavedConnection, "kind" | "readOnly"> | null | undefined,
): boolean {
  if (!connection?.readOnly) return false;
  return capabilitiesFor(connection.kind).read_only_mode;
}

registerReadOnlyResolver(() => {
  const state = useConnectionsStore.getState();
  const active = state.connections.find((connection) => connection.id === state.activeId);
  return isReadOnlyConnection(active);
});

export function useReadOnlyConnection(): boolean {
  return useConnectionsStore((state) =>
    isReadOnlyConnection(
      state.connections.find((connection) => connection.id === state.activeId) ?? null,
    ),
  );
}

export function useActiveConnection(): SavedConnection | null {
  return useConnectionsStore(
    (state) => state.connections.find((connection) => connection.id === state.activeId) ?? null,
  );
}
