import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { DatabaseKind } from "@/lib/db";

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

export interface SavedConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  tags?: ConnectionTag[];
}

export type ConnectionInput = Omit<SavedConnection, "id">;

interface ConnectionsState {
  connections: SavedConnection[];
  activeId: string | null;
  addConnection: (input: ConnectionInput) => SavedConnection;
  updateConnection: (id: string, input: ConnectionInput) => void;
  removeConnection: (id: string) => void;
  setActiveId: (id: string | null) => void;
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const useConnectionsStore = create<ConnectionsState>()(
  persist(
    (set) => ({
      connections: [],
      activeId: null,
      addConnection: (input) => {
        const connection: SavedConnection = { ...input, id: createId() };
        set((state) => ({
          connections: [...state.connections, connection],
          activeId: state.activeId ?? connection.id,
        }));
        return connection;
      },
      updateConnection: (id, input) =>
        set((state) => ({
          connections: state.connections.map((connection) =>
            connection.id === id ? { ...input, id } : connection,
          ),
        })),
      removeConnection: (id) =>
        set((state) => ({
          connections: state.connections.filter(
            (connection) => connection.id !== id,
          ),
          activeId: state.activeId === id ? null : state.activeId,
        })),
      setActiveId: (id) => set({ activeId: id }),
    }),
    {
      name: "l8db.connections",
      partialize: (state) => ({
        connections: state.connections,
        activeId: state.activeId,
      }),
    },
  ),
);

export function useActiveConnection(): SavedConnection | null {
  return useConnectionsStore(
    (state) =>
      state.connections.find(
        (connection) => connection.id === state.activeId,
      ) ?? null,
  );
}
