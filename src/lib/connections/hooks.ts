import { createContext, useContext } from "react";
import { isProductionLocked, useWriteModeStore } from "@/lib/environments";
import { useSettingsStore } from "@/lib/settings";
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
  useSettingsStore((state) => state.productionReadOnly);
  useWriteModeStore((state) => (id ? state.unlockedUntil[id] : undefined));
  useConnectionsStore((state) => state.hostGroupRules);
  return useConnectionsStore((state) => {
    const connection = state.connections.find((entry) => entry.id === id) ?? null;
    return isReadOnlyConnection(connection) || isProductionLocked(connection);
  });
}

export function useActiveConnection(): SavedConnection | null {
  const id = useActiveConnectionId();
  return useConnectionsStore(
    (state) => state.connections.find((connection) => connection.id === id) ?? null,
  );
}
