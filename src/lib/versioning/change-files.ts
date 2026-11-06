import { checksum, identifier } from "./model";
import { changePath, encode, parseChange, readFile, saveFile } from "./repository";
import type { ChangeFile, ReleaseCheck, VersioningProject } from "./types";

export interface ChangeInput {
  id: string;
  title: string;
  sql: string;
  touches: string[];
  before: Record<string, string | null>;
  data: boolean;
  preconditions: ReleaseCheck[];
}

export async function createStandaloneChange(
  repo: string,
  project: VersioningProject,
  input: ChangeInput,
) {
  if (!identifier(input.id)) throw new Error("Ungültige Änderungs-ID.");
  const path = changePath(input.id);
  const sqlPath = path.replace(/\.json$/, ".sql");
  if ((await readFile(repo, path)) !== null || (await readFile(repo, sqlPath)) !== null)
    throw new Error("Diese Änderungs-ID existiert bereits.");
  const sql = input.sql.trim();
  const manifest: ChangeFile = {
    format: 1,
    id: input.id,
    kind: "versioned",
    title: input.title.trim(),
    checksum: await checksum(sql),
    touches: input.touches,
    before: input.before,
    requires: [],
    data: input.data,
    preconditions: await Promise.all(
      input.preconditions.map(async (check) => ({ ...check, checksum: await checksum(check.sql) })),
    ),
    postconditions: [],
  };
  await parseChange(encode(manifest), sql, project);
  await saveFile(repo, sqlPath, `${sql}\n`, null);
  await saveFile(repo, path, encode(manifest), null);
  return [path, sqlPath];
}
