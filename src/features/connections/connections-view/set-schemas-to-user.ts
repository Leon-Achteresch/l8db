import { toast } from "sonner";
import { connectionUser, type ServerGroup } from "@/lib/connection-groups";
import { useConnectionsStore } from "@/lib/connections";

export function setSchemasToUser(group: ServerGroup) {
  const ids = new Set(group.connections.map((connection) => connection.id));
  const users = new Map(
    group.connections
      .map((connection) => [connection.id, connectionUser(connection)] as const)
      .filter((entry) => entry[1]),
  );
  if (users.size === 0) {
    toast.error("Für diese Connections wurde kein Username gefunden.");
    return;
  }
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((connection) => {
      const user = users.get(connection.id);
      return ids.has(connection.id) && user ? { ...connection, schemas: [user] } : connection;
    }),
  }));
  toast.success(`Schema-Filter für ${users.size} Connections auf Username gesetzt`);
}
