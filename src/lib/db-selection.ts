import { create } from "zustand";
import { persist } from "zustand/middleware";

import { useActiveConnection } from "@/lib/connections";
import type { Capabilities } from "@/lib/db";
import { useCapabilities } from "@/lib/providers";
import { useSchemasQuery } from "@/lib/queries";

interface DbSelectionState {
  databaseByConnection: Record<string, string>;
  schemaByConnection: Record<string, string>;
  setDatabase: (connectionId: string, database: string) => void;
  setSchema: (connectionId: string, schema: string) => void;
}

export const useDbSelectionStore = create<DbSelectionState>()(
  persist(
    (set) => ({
      databaseByConnection: {},
      schemaByConnection: {},
      setDatabase: (connectionId, database) =>
        set((state) => {
          const schemaByConnection = { ...state.schemaByConnection };
          delete schemaByConnection[connectionId];
          return {
            databaseByConnection: {
              ...state.databaseByConnection,
              [connectionId]: database,
            },
            schemaByConnection,
          };
        }),
      setSchema: (connectionId, schema) =>
        set((state) => ({
          schemaByConnection: {
            ...state.schemaByConnection,
            [connectionId]: schema,
          },
        })),
    }),
    {
      name: "l8db.db-selection",
      partialize: (state) => ({
        databaseByConnection: state.databaseByConnection,
        schemaByConnection: state.schemaByConnection,
      }),
    },
  ),
);

export function databaseFromConnectionString(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    if (!url.host) return null;
    const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    return database || null;
  } catch {
    return null;
  }
}

export function useActiveDatabase(): string | null {
  const connection = useActiveConnection();
  const selected = useDbSelectionStore((state) =>
    connection ? (state.databaseByConnection[connection.id] ?? null) : null,
  );
  if (!connection) {
    return null;
  }
  return selected ?? databaseFromConnectionString(connection.connectionString);
}

export function useActiveSchema(): string {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const schemas = useSchemasQuery().data;
  const selected = useDbSelectionStore((state) =>
    connection ? (state.schemaByConnection[connection.id] ?? null) : null,
  );
  if (selected && (!schemas || schemas.includes(selected))) return selected;
  if (database && schemas?.includes(database)) return database;
  if (!schemas?.length || schemas.includes("public")) return "public";
  return schemas[0];
}

export function useActiveCapabilities(): Capabilities {
  const connection = useActiveConnection();
  return useCapabilities(connection?.kind);
}
