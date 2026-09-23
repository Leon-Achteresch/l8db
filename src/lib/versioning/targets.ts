import type { SavedConnection } from "@/lib/connections";
import { listSchemas } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { readTargets, saveTargets } from "./repository";
import { databaseBinding } from "./session";
import type { DatabaseTarget, VersioningProject } from "./types";

export async function assertDistinctTarget(
  candidate: DatabaseTarget,
  connection: SavedConnection,
  targets: DatabaseTarget[],
  connections: SavedConnection[],
  project: VersioningProject,
) {
  const binding = await databaseBinding(connection, candidate);
  for (const existing of targets) {
    if (existing.id === candidate.id) continue;
    const otherConnection = connections.find((item) => item.id === existing.connectionId);
    const otherBinding = existing.binding?.physicalKey
      ? existing.binding
      : otherConnection
        ? await databaseBinding(otherConnection, {
            ...existing,
            ledgerSchema:
              existing.ledgerSchema ||
              existing.schema ||
              project.objects[0]?.selection.schema ||
              undefined,
          })
        : existing.binding;
    if (
      !otherBinding?.physicalKey &&
      (existing.database === candidate.database || !existing.database || !candidate.database) &&
      (existing.ledgerSchema || existing.schema || project.objects[0]?.selection.schema) ===
        (candidate.ledgerSchema || candidate.schema || project.objects[0]?.selection.schema)
    )
      throw new Error(
        `Verbindung für ${existing.name} fehlt. Die Eindeutigkeit des Kundenschemas kann nicht geprüft werden.`,
      );
    if (otherBinding?.physicalKey && otherBinding.physicalKey === binding.physicalKey)
      throw new Error(
        `${existing.name} verwendet bereits dieselbe Datenbank und dasselbe Schema. Kundenziele müssen physisch getrennt sein.`,
      );
  }
  return binding;
}

export async function addTarget(
  repo: string,
  project: VersioningProject,
  connections: SavedConnection[],
  input: Pick<DatabaseTarget, "name" | "connectionId" | "database" | "schema" | "production">,
) {
  const connection = connections.find((item) => item.id === input.connectionId);
  const schema = input.schema?.trim();
  if (!input.name.trim() || !connection || connection.kind !== project.kind || !schema)
    throw new Error("Kundenname, passende Verbindung und Zielschema auswählen.");
  if (connection.readOnly)
    throw new Error("Die Zielverbindung ist schreibgeschützt und kann nicht versioniert werden.");
  const sourceSchemas = new Set(project.objects.map((item) => item.selection.schema));
  if (sourceSchemas.size !== 1)
    throw new Error(
      "Für Kundenschemas muss das Projekt genau ein Quellschema verwalten. Zuerst ein Schema aufnehmen.",
    );
  const database = input.database?.trim() || null;
  const available = await listSchemas(
    connection.kind,
    effectiveConnectionString(connection),
    database ?? undefined,
  );
  if (!available.includes(schema))
    throw new Error(
      `Schema ${schema} ist in der gewählten Datenbank nicht vorhanden oder nicht lesbar.`,
    );
  const candidate: DatabaseTarget = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    connectionId: connection.id,
    database,
    schema,
    production: input.production,
    release: null,
    history: [],
  };
  const { store, text } = await readTargets(repo, project.id);
  await assertDistinctTarget(candidate, connection, store.targets, connections, project);
  store.targets.push(candidate);
  await saveTargets(repo, store, text);
  return candidate;
}
