import { useEffect, useMemo } from "react";
import { connectionUser, siblingConnections } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";
import { useActiveDatabase, useActiveSchema, useDbSelectionStore } from "@/lib/db-selection";
import { useDatabaseCatalogQuery, useSchemasQuery } from "@/lib/queries";

export function useSidebarScope(
  connections: SavedConnection[],
  activeConnection: SavedConnection | null,
) {
  const setDatabase = useDbSelectionStore((state) => state.setDatabase);
  const setSchema = useDbSelectionStore((state) => state.setSchema);
  const activeDatabase = useActiveDatabase();
  const activeSchema = useActiveSchema();
  const catalog = useDatabaseCatalogQuery();
  const databases = Array.isArray(catalog.data) ? catalog.data : catalog.data?.databases;
  const retentionByBucket = catalog.isError ? undefined : catalog.data?.bucket_retention;
  const bucketRetention =
    activeDatabase && retentionByBucket && Object.hasOwn(retentionByBucket, activeDatabase)
      ? retentionByBucket[activeDatabase]
      : undefined;
  const { data: schemas, isLoading: schemasLoading } = useSchemasQuery();
  const activeId = activeConnection?.id;
  const remembered = useDbSelectionStore((state) =>
    activeId ? state.schemaByConnection[activeId] : undefined,
  );
  useEffect(() => {
    if (activeId && !remembered && schemas?.includes(activeSchema))
      setSchema(activeId, activeSchema);
  }, [activeId, remembered, schemas, activeSchema, setSchema]);
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
    databasesLoading: catalog.isLoading,
    bucketRetention,
    schemas,
    schemasLoading,
    siblings,
    activeUser,
  };
}

export type SidebarScope = ReturnType<typeof useSidebarScope>;
