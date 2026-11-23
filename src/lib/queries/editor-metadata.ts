import { type SavedConnection, useConnectionsStore } from "@/lib/connections";

export function editorMetadataEnabled(
  connection: SavedConnection | null,
  sqlEditor: boolean,
): boolean {
  if (!connection) return false;
  if (!sqlEditor) return true;
  if (connection.editorMetadataPrefetch === false) return false;
  const saved = useConnectionsStore.getState().connections.find(({ id }) => id === connection.id);
  return saved?.editorMetadataPrefetch !== false;
}
