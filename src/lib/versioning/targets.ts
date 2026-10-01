import type { SavedConnection } from "@/lib/connections";
import { listSchemas } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { readTargets, saveTargets } from "./repository";
import { databaseBinding } from "./session";
import { describeTeamConnection, ensureTeamConnection } from "./team";
import type { DatabaseTarget, VersioningProject } from "./types";

export async function assertDistinctTarget(
  candidate: DatabaseTarget,
  connection: SavedConnection,
  targets: DatabaseTarget[],
  connections: SavedConnection[],
  project: VersioningProject,
) {
  const binding = await databaseBinding(connection, candidate);
  if (candidate.expectedPhysicalKey && candidate.expectedPhysicalKey !== binding.physicalKey)
    throw new Error("Die Datenbankidentität entspricht nicht der gemeinsamen Git-Zuordnung.");
  for (const existing of targets) {
    if (existing.id === candidate.id) continue;
    const otherConnection = connections.find((item) => item.id === existing.connectionId);
    const otherBinding = existing.binding?.physicalKey
      ? existing.binding
      : existing.expectedPhysicalKey
        ? { physicalKey: existing.expectedPhysicalKey }
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
  input: Pick<
    DatabaseTarget,
    "name" | "connectionId" | "database" | "schema" | "production" | "customer" | "environment"
  >,
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
    customer: input.customer?.trim() || input.name.trim(),
    environment: input.environment?.trim() || (input.production ? "Produktion" : "Development"),
    connectionId: connection.id,
    database,
    schema,
    production: input.production,
    release: null,
    history: [],
  };
  const { store, text } = await readTargets(repo, project.id);
  candidate.connectionRef = ensureTeamConnection(store, connection);
  candidate.binding = await assertDistinctTarget(
    candidate,
    connection,
    store.targets,
    connections,
    project,
  );
  store.targets.push(candidate);
  await saveTargets(repo, store, text);
  return candidate;
}

export async function bindTeamConnection(
  repo: string,
  project: VersioningProject,
  ref: string,
  connection: SavedConnection,
  connections: SavedConnection[],
) {
  const { store, text } = await readTargets(repo, project.id);
  const descriptor = store.connections?.find((entry) => entry.id === ref);
  if (!descriptor || descriptor.kind !== connection.kind || connection.kind !== project.kind)
    throw new Error("Lokale Verbindung passt nicht zur gemeinsamen Verbindung.");
  const modes = ["disable", "prefer", "require", "verify-ca", "verify-full"];
  if (
    modes.indexOf(connection.sslMode) < modes.indexOf(descriptor.sslMode) ||
    (descriptor.requiresTunnel && !connection.ssh?.host && !connection.proxy?.host)
  )
    throw new Error("TLS- oder Tunnelanforderung der gemeinsamen Verbindung wird nicht erfüllt.");
  const chosen = store.targets.filter((target) => target.connectionRef === ref);
  if (!chosen.length) {
    const local = describeTeamConnection(connection);
    if (
      local.host !== descriptor.host ||
      local.port !== descriptor.port ||
      local.service !== descriptor.service
    )
      throw new Error("Lokaler Endpunkt passt nicht zur gemeinsamen Entwicklungsverbindung.");
  }
  for (const target of chosen) {
    const candidate = { ...target, connectionId: connection.id };
    const binding = await assertDistinctTarget(
      candidate,
      connection,
      store.targets,
      connections,
      project,
    );
    target.connectionId = connection.id;
    target.binding = binding;
  }
  store.connectionBindings = { ...store.connectionBindings, [ref]: connection.id };
  await saveTargets(repo, store, text);
}

export async function updateTargetDetails(
  repo: string,
  projectId: string,
  id: string,
  details: Pick<DatabaseTarget, "name" | "customer" | "environment">,
) {
  if (!details.name.trim() || !details.customer?.trim() || !details.environment?.trim())
    throw new Error("Kunde, Umgebung und Zielname ausfüllen.");
  const { store, text } = await readTargets(repo, projectId);
  const target = store.targets.find((item) => item.id === id);
  if (!target) throw new Error("Zielzuordnung fehlt.");
  Object.assign(target, {
    name: details.name.trim(),
    customer: details.customer.trim(),
    environment: details.environment.trim(),
  });
  await saveTargets(repo, store, text);
}

export async function removeTarget(repo: string, projectId: string, id: string) {
  const { store, text } = await readTargets(repo, projectId);
  const target = store.targets.find((item) => item.id === id);
  if (!target) throw new Error("Zielzuordnung fehlt.");
  if (target.history.some((event) => event.status === "running" || event.status === "failed"))
    throw new Error("Ungeklärte Deployments zuerst abgleichen.");
  store.targets = store.targets.filter((item) => item.id !== id);
  for (const branch of Object.values(store.branches ?? {}))
    if (branch.targetId === id) delete branch.targetId;
  await saveTargets(repo, store, text);
}
