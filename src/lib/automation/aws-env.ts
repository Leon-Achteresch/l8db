import { awsAuthMode, isAwsKind } from "@/lib/aws";
import type { SavedConnection } from "@/lib/connections";
import type { Step } from "@/lib/db/automation";

const KEYS = new Set(["connection", "connections", "source", "target"]);

function collect(value: unknown, ids: Set<string>, key: string) {
  if (typeof value === "string") {
    if (KEYS.has(key)) ids.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, ids, key);
  } else if (value && typeof value === "object") {
    for (const [name, child] of Object.entries(value)) collect(child, ids, name);
  }
}

function usesEnvAuth(connection: SavedConnection): boolean {
  try {
    const url = new URL(connection.connectionString);
    return awsAuthMode(decodeURIComponent(url.username), url.search) === "env";
  } catch {
    return false;
  }
}

export function awsEnvConnections(steps: Step[], connections: SavedConnection[]): string[] {
  const ids = new Set<string>();
  collect(steps, ids, "");
  return connections
    .filter((connection) => ids.has(connection.id) && isAwsKind(connection.kind))
    .filter(usesEnvAuth)
    .map((connection) => connection.name);
}
