import { createContext, useContext } from "react";
import { isReadOnlyConnection } from "./secrets";
import { useConnectionsStore } from "./store";
import type { SavedConnection } from "./types";

export const ConnectionScopeContext = createContext<string | null>(null);

export function useActiveConnectionId(): string | null {
  const scoped = useContext(ConnectionScopeContext);
  return useConnectionsStore((state) => scoped ?? state.activeId);
}

export function useReadOnlyConnection(): boolean {
  const id = useActiveConnectionId();
  return useConnectionsStore((state) =>
    isReadOnlyConnection(state.connections.find((connection) => connection.id === id) ?? null),
  );
}

export function useActiveConnection(): SavedConnection | null {
  const id = useActiveConnectionId();
  return useConnectionsStore(
    (state) => state.connections.find((connection) => connection.id === id) ?? null,
  );
}
