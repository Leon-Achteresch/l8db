import { useMemo } from "react";
import { connectionUser, siblingConnections } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema, useDbSelectionStore } from "@/lib/db-selection";
import { useDatabasesQuery, useSchemasQuery } from "@/lib/queries";

export function useSidebarScope(
  connections: SavedConnection[],
  activeConnection: SavedConnection | null,
) {
  const setDatabase = useDbSelectionStore((state) => state.setDatabase);
  const setSchema = useDbSelectionStore((state) => state.setSchema);
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const { data: databases, isLoading: databasesLoading } = useDatabasesQuery();
  const { data: schemas, isLoading: schemasLoading } = useSchemasQuery();
  const siblings = useMemo(
    () => siblingConnections(connections, activeConnection),
    [connections, activeConnection],
  );
  const activeUser = activeConnection ? connectionUser(activeConnection) : "";
  return {
    setDatabase,
    setSchema,
    activeDatabase,
    activeSchema,
    databases,
    databasesLoading,
    schemas,
    schemasLoading,
    siblings,
    activeUser,
  };
}

export type SidebarScope = ReturnType<typeof useSidebarScope>;
