import type { CompareSideSelection } from "@/lib/compare-types";
import { checksum, normalizeSource } from "./model";
import { readFile } from "./repository";
import type { ManagedObject, ObjectSnapshot } from "./types";

export function newManagedObject(side: CompareSideSelection): ManagedObject {
  const id = crypto.randomUUID();
  const stem = `${side.schema}-${side.objectName}-${side.objectType}`
    .replace(/[^A-Za-z0-9_-]/g, "_")
    .slice(0, 90);
  const path = `database/objects/${stem}-${id.slice(0, 8)}`;
  const { connectionId: _connectionId, database: _database, ...selection } = side;
  return {
    id,
    path: `${path}.${side.objectType === "package" ? "pks" : "sql"}`,
    ...(side.objectType === "package" ? { bodyPath: `${path}.pkb` } : {}),
    selection,
  };
}

export function sourceFiles(snapshot: ObjectSnapshot): Record<string, string> {
  const { object, definition } = snapshot;
  if (!object.bodyPath) return { [object.path]: `${definition}\n` };
  const match = /^PACKAGE SPEC [^\n]+\n+([\s\S]*?)\n+PACKAGE BODY [^\n]+(?:\n+([\s\S]*))?$/.exec(
    definition,
  );
  if (!match)
    throw new Error("Package-Definition konnte nicht in Specification und Body aufgeteilt werden.");
  return {
    [object.path]: `${normalizeSource(match[1])}\n`,
    [object.bodyPath]: match[2] ? `${normalizeSource(match[2])}\n` : "",
  };
}

export async function workingSnapshot(
  repo: string,
  object: ManagedObject,
): Promise<ObjectSnapshot> {
  const source = await readFile(repo, object.path);
  if (!source?.trim()) throw new Error(`Definition ${object.path} fehlt.`);
  let definition = normalizeSource(source);
  if (object.bodyPath) {
    const body = await readFile(repo, object.bodyPath);
    if (body === null) throw new Error(`Package-Body-Datei ${object.bodyPath} fehlt.`);
    const name = `"${object.selection.schema?.replaceAll('"', '""')}".${object.selection.objectName}`;
    definition = normalizeSource(
      [`PACKAGE SPEC ${name}`, definition, `PACKAGE BODY ${name}`, normalizeSource(body)].join(
        "\n\n",
      ),
    );
  }
  if (/^(?:<{7}|>{7}|\|{7})/m.test(definition))
    throw new Error("Definition enthält ungelöste Merge-Konflikte.");
  return { object, definition, checksum: await checksum(definition) };
}
