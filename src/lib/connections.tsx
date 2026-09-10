import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { DatabaseKind } from "@/lib/db";

export interface SavedConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
}

export type ConnectionInput = Omit<SavedConnection, "id">;

interface ConnectionsContextValue {
  connections: SavedConnection[];
  activeId: string | null;
  activeConnection: SavedConnection | null;
  addConnection: (input: ConnectionInput) => SavedConnection;
  updateConnection: (id: string, input: ConnectionInput) => void;
  removeConnection: (id: string) => void;
  setActiveId: (id: string | null) => void;
}

const STORAGE_KEY = "l8db.connections";
const ACTIVE_KEY = "l8db.activeConnection";

const ConnectionsContext = createContext<ConnectionsContextValue | null>(null);

function readStored(): SavedConnection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedConnection[]) : [];
  } catch {
    return [];
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export function ConnectionsProvider({ children }: { children: ReactNode }) {
  const [connections, setConnections] = useState<SavedConnection[]>(readStored);
  const [activeId, setActiveIdState] = useState<string | null>(() =>
    localStorage.getItem(ACTIVE_KEY),
  );

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(connections));
  }, [connections]);

  useEffect(() => {
    if (activeId) {
      localStorage.setItem(ACTIVE_KEY, activeId);
    } else {
      localStorage.removeItem(ACTIVE_KEY);
    }
  }, [activeId]);

  const setActiveId = useCallback((id: string | null) => {
    setActiveIdState(id);
  }, []);

  const addConnection = useCallback((input: ConnectionInput) => {
    const connection: SavedConnection = { ...input, id: createId() };
    setConnections((previous) => [...previous, connection]);
    setActiveIdState((previous) => previous ?? connection.id);
    return connection;
  }, []);

  const updateConnection = useCallback((id: string, input: ConnectionInput) => {
    setConnections((previous) =>
      previous.map((connection) =>
        connection.id === id ? { ...input, id } : connection,
      ),
    );
  }, []);

  const removeConnection = useCallback((id: string) => {
    setConnections((previous) =>
      previous.filter((connection) => connection.id !== id),
    );
    setActiveIdState((previous) => (previous === id ? null : previous));
  }, []);

  const activeConnection = useMemo(
    () => connections.find((connection) => connection.id === activeId) ?? null,
    [connections, activeId],
  );

  const value = useMemo<ConnectionsContextValue>(
    () => ({
      connections,
      activeId,
      activeConnection,
      addConnection,
      updateConnection,
      removeConnection,
      setActiveId,
    }),
    [
      connections,
      activeId,
      activeConnection,
      addConnection,
      updateConnection,
      removeConnection,
      setActiveId,
    ],
  );

  return (
    <ConnectionsContext.Provider value={value}>
      {children}
    </ConnectionsContext.Provider>
  );
}

export function useConnections(): ConnectionsContextValue {
  const context = useContext(ConnectionsContext);
  if (!context) {
    throw new Error("useConnections must be used within a ConnectionsProvider");
  }
  return context;
}
