import { toast } from "sonner";
import { connectionUser, type ServerGroup } from "@/lib/connection-groups";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";

export function schemaForUser(connection: Pick<SavedConnection, "connectionString" | "kind">) {
  const user = connectionUser(connection);
  if (connection.kind !== "oracle") return user;
  const quoted = /^"(.+)"$/.exec(user);
  return quoted ? quoted[1] : user.toUpperCase();
}

function applySchemas(schemas: Map<string, string[] | null>) {
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((connection) =>
      schemas.has(connection.id)
        ? { ...connection, schemas: schemas.get(connection.id) ?? null }
        : connection,
    ),
  }));
}

export function setSchemasToUser(group: ServerGroup) {
  const users = new Map<string, string[] | null>();
  for (const connection of group.connections) {
    const user = connection.team ? "" : schemaForUser(connection);
    if (user) users.set(connection.id, [user]);
  }
  if (users.size === 0) {
    toast.error("Für diese Verbindungen wurde kein Benutzer gefunden.");
    return;
  }
  const previous = new Map(
    useConnectionsStore
      .getState()
      .connections.filter((connection) => users.has(connection.id))
      .map((connection) => [connection.id, connection.schemas ?? null] as const),
  );
  applySchemas(users);
  toast.success(`Schema-Filter für ${users.size} Verbindungen auf den Benutzer gesetzt`, {
    action: { label: "Rückgängig", onClick: () => applySchemas(previous) },
  });
}
