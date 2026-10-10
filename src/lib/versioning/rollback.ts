import { PROJECT_PATH, parseProject, releaseTrack } from "./model";
import { deleteFile, encode, readFile, saveFile } from "./repository";
import { sourceFiles } from "./sources";
import type { DatabaseRelease, VersioningProject } from "./types";

export function rollbackBases(releases: DatabaseRelease[], release: DatabaseRelease) {
  const map = new Map(releases.map((entry) => [entry.id, entry]));
  const extended = new Set(
    releases.flatMap((entry) => {
      const parent = entry.parent ? map.get(entry.parent) : undefined;
      return parent && releaseTrack(parent) === releaseTrack(entry) ? [parent.id] : [];
    }),
  );
  return releases.filter((tip) => {
    if (tip.id === release.id || extended.has(tip.id)) return false;
    const seen = new Set<string>();
    let current = tip.parent;
    while (current && !seen.has(current)) {
      if (current === release.id) return true;
      const entry = map.get(current);
      if (!entry || releaseTrack(entry) !== releaseTrack(tip)) return false;
      seen.add(current);
      current = entry.parent;
    }
    return false;
  });
}

export async function restoreReleaseFiles(
  repo: string,
  project: VersioningProject,
  projectText: string | null,
  release: DatabaseRelease,
  head: string,
) {
  const clean = async (path: string) => {
    const [current, committed] = await Promise.all([
      readFile(repo, path),
      readFile(repo, path, head).catch(() => null),
    ]);
    if (current !== committed)
      throw new Error(`${path} hat lokale Änderungen. Zuerst committen oder verwerfen.`);
    return current;
  };
  if ((await clean(PROJECT_PATH)) !== projectText)
    throw new Error("project.json wurde zwischenzeitlich geändert. Neu laden.");
  const files = new Map<string, string>();
  for (const snapshot of release.objects)
    for (const [path, content] of Object.entries(sourceFiles(snapshot))) files.set(path, content);
  const next = { ...project, objects: release.objects.map((snapshot) => snapshot.object) };
  parseProject(JSON.stringify(next));
  const changed: string[] = [];
  for (const [path, content] of files) {
    const current = await clean(path);
    if (current === content) continue;
    await saveFile(repo, path, content, current);
    changed.push(path);
  }
  for (const object of project.objects)
    for (const path of [object.path, object.bodyPath]) {
      if (!path || files.has(path)) continue;
      const current = await clean(path);
      if (current === null) continue;
      await deleteFile(repo, path, current);
      changed.push(path);
    }
  const text = encode(next);
  if (text !== projectText) {
    await saveFile(repo, PROJECT_PATH, text, projectText);
    changed.push(PROJECT_PATH);
  }
  return { objects: next.objects, changed };
}
