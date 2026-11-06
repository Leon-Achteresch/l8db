import { useConnectionsStore } from "@/lib/connections";
import { type WorkspaceConnection, workspaceConnectionUrl } from "@/lib/db/workspaces";
import { activateConnectionWithToast } from "@/lib/ssh";

export async function activateWorkspaceConnection(
  profile: string,
  connection: WorkspaceConnection,
): Promise<boolean> {
  const address = workspaceConnectionUrl(profile, connection.id);
  const store = useConnectionsStore.getState();
  const input = {
    name: `${connection.name} · Team`,
    kind: "workspace" as const,
    connectionString: address,
    sslMode: "require" as const,
    readOnly: connection.access === "read",
  };
  let saved = store.connections.find((item) => item.connectionString === address);
  if (saved) {
    store.updateConnection(saved.id, { ...saved, ...input });
  } else {
    saved = store.addConnection(input);
  }
  return activateConnectionWithToast(saved.id);
}
