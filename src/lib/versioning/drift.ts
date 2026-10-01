import { listCompareObjects } from "@/lib/compare-definition";
import { type CompareSideSelection, supportedCompareObjectTypes } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";
import { captureObject } from "./capture";
import { PROJECT_PATH } from "./model";
import { oracleIdentityMetadataSql } from "./oracle-metadata";
import { deleteFile, encode, readFile, saveFile } from "./repository";
import { newManagedObject, sourceFiles } from "./sources";
import type { ManagedObject, VersioningProject } from "./types";

export type DriftStatus = "changed" | "added" | "removed";

export interface DriftEntry {
  object: ManagedObject;
  status: DriftStatus;
  repository: Record<string, string | null>;
  database: Record<string, string> | null;
}

const sameObject = (object: ManagedObject, schema: string, type: string, name: string) =>
  object.selection.schema === schema &&
  object.selection.objectType === type &&
  object.selection.objectName === name;

const joined = (files: Record<string, string | null> | null) =>
  Object.values(files ?? {})
    .filter((value) => value !== null)
    .join("\n");

export const repositoryText = (entry: DriftEntry) => joined(entry.repository);
export const databaseText = (entry: DriftEntry) => joined(entry.database);

export async function scanDrift(
  repo: string,
  project: VersioningProject,
  connection: SavedConnection,
  source: CompareSideSelection,
  progress: (label: string) => void,
): Promise<DriftEntry[]> {
  const schema = source.schema;
  if (!schema) throw new Error("Ein Schema der Entwicklungsdatenbank auswählen.");
  const entries: DriftEntry[] = [];
  const seen = new Set<string>();
  const identitySequences = new Set(
    connection.kind === "oracle"
      ? (
          await executeQuery(
            connection.kind,
            effectiveConnectionString(connection),
            oracleIdentityMetadataSql(schema),
            source.database ?? undefined,
          )
        ).rows.map((row) => String(row.sequence))
      : [],
  );
  const read = async (files: string[]) =>
    Object.fromEntries(
      await Promise.all(files.map(async (file) => [file, await readFile(repo, file)])),
    );
  for (const objectType of supportedCompareObjectTypes(connection)) {
    const listed = await listCompareObjects(connection, { ...source, objectType });
    for (const item of listed) {
      if (item.name.toUpperCase().startsWith("L8DB_VERSIONING_")) continue;
      if (
        objectType === "sequence" &&
        identitySequences.has(item.name) &&
        !project.objects.some((entry) => sameObject(entry, schema, objectType, item.name))
      )
        continue;
      if (seen.size >= 5000)
        throw new Error("Mehr als 5000 Objekte. Bitte ein kleineres Schema wählen.");
      progress(item.name);
      const object =
        project.objects.find((entry) => sameObject(entry, schema, objectType, item.name)) ??
        newManagedObject({ ...source, objectType, objectName: item.name, objectOid: item.oid });
      seen.add(object.id);
      const database = sourceFiles(await captureObject(connection, source.database, object));
      const repository = await read(Object.keys(database));
      const known = project.objects.some((entry) => entry.id === object.id);
      if (!known) entries.push({ object, status: "added", repository, database });
      else if (Object.entries(database).some(([file, text]) => repository[file] !== text))
        entries.push({ object, status: "changed", repository, database });
    }
  }
  for (const object of project.objects) {
    if (object.selection.schema !== schema || seen.has(object.id)) continue;
    const files = [object.path, ...(object.bodyPath ? [object.bodyPath] : [])];
    entries.push({ object, status: "removed", repository: await read(files), database: null });
  }
  return entries;
}

export async function saveDrift(
  repo: string,
  project: VersioningProject,
  projectText: string | null,
  entries: DriftEntry[],
): Promise<void> {
  if ((await readFile(repo, PROJECT_PATH)) !== projectText)
    throw new Error("Projektdatei wurde inzwischen geändert. Bitte erneut vergleichen.");
  for (const entry of entries) {
    if (entry.database) {
      for (const [file, text] of Object.entries(entry.database))
        await saveFile(repo, file, text, entry.repository[file] ?? null);
      continue;
    }
    for (const [file, text] of Object.entries(entry.repository))
      if (text !== null) await deleteFile(repo, file, text);
  }
  const removed = new Set(
    entries.filter((entry) => entry.status === "removed").map((entry) => entry.object.id),
  );
  const added = entries.filter((entry) => entry.status === "added").map((entry) => entry.object);
  if (!removed.size && !added.length) return;
  await saveFile(
    repo,
    PROJECT_PATH,
    encode({
      ...project,
      objects: [...project.objects.filter((object) => !removed.has(object.id)), ...added],
    }),
    projectText,
  );
}
