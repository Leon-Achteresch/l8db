import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import type { SavedConnection } from "@/lib/connections/types";
import { type CloudCreatedConnection, savedConnectionFrom } from "@/lib/db/cloud-accounts";

export function addCloudConnection(created: CloudCreatedConnection): SavedConnection {
  const connection: SavedConnection = savedConnectionFrom(created);
  useConnectionsStore.getState().addImported([connection]);
  toast.success(`Verbindung „${created.name}“ angelegt`, {
    description: "Das Passwort liegt nur im Schlüsselbund des Systems.",
  });
  return connection;
}

export function cloudErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "Unbekannter Fehler.";
}
