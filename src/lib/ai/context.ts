import { isReadOnlyConnection, type SavedConnection } from "@/lib/connections";
import type { AiConnection } from "@/lib/db/ai";
import { databaseFromConnectionString } from "@/lib/db-selection";
import { connectionEnvironment, isProductionLocked } from "@/lib/environments";
import { effectiveConnectionString } from "@/lib/ssh";

export function aiConnections(
  connections: SavedConnection[],
  activeId: string | null,
  mentionedIds: string[],
  databases: Record<string, string>,
): AiConnection[] {
  const ids = [...new Set([...(activeId ? [activeId] : []), ...mentionedIds])];
  return ids.map((id) => {
    const connection = connections.find((entry) => entry.id === id);
    if (!connection) throw new Error("Eine ausgewählte Verbindung ist nicht mehr verfügbar.");
    return {
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      connectionString: effectiveConnectionString(connection),
      database: databases[id] ?? databaseFromConnectionString(connection.connectionString),
      schemas: connection.schemas ?? [],
      readOnly:
        Boolean(connection.readOnly) ||
        isReadOnlyConnection(connection) ||
        isProductionLocked(connection),
      environment: connectionEnvironment(connection),
      maskRules: connection.maskRules ?? [],
    };
  });
}
export function bypassAiPermissions(value: string): boolean {
  const mode = (value.toLowerCase().split(/[/#]/).pop() ?? "").replace(/[-_\s]/g, "");
  return [
    "bypasspermissions",
    "yolo",
    "dangerfullaccess",
    "autopilot",
    "autoapprove",
    "allowall",
  ].includes(mode);
}
export function modeOptions(values: unknown): { id: string; name: string }[] {
  const source =
    values && typeof values === "object" && "availableModes" in values
      ? values.availableModes
      : values;
  if (!Array.isArray(source)) return [];
  return source
    .flatMap((value) => {
      if (typeof value === "string") return [{ id: value, name: value }];
      if (value && typeof value === "object" && "id" in value && typeof value.id === "string")
        return [
          {
            id: value.id,
            name: "name" in value && typeof value.name === "string" ? value.name : value.id,
          },
        ];
      return [];
    })
    .filter((mode) => !bypassAiPermissions(mode.id));
}
export function mergeAiModels(
  previous: import("@/lib/db/ai").AiModels,
  data: Record<string, unknown>,
): import("@/lib/db/ai").AiModels {
  let source = data.models;
  if (source && typeof source === "object" && "availableModels" in source)
    source = source.availableModels;
  const models = Array.isArray(source)
    ? source.flatMap((model) => {
        if (!model || typeof model !== "object") return [];
        const id = model.id ?? model.modelId ?? model.value ?? model.model;
        return typeof id === "string"
          ? [
              {
                id,
                name: String(model.name ?? model.displayName ?? id),
                efforts: Array.isArray(model.efforts) ? model.efforts : undefined,
              },
            ]
          : [];
      })
    : previous.models;
  return {
    models,
    modes: data.modes ?? previous.modes,
    configOptions: Array.isArray(data.configOptions) ? data.configOptions : previous.configOptions,
    commands: Array.isArray(data.commands) ? data.commands : previous.commands,
  };
}
export function safeEndpoint(value: string): string {
  if (!value.trim()) return "";
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Endpoint ohne Zugangsdaten oder URL-Parameter angeben.");
  return url.toString();
}
